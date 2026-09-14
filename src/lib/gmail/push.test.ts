import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { parsePushNotification, resolveGmailPushConfig, verifyPushToken, watchGmailInbox } from "./push.ts";

const config = {
  audience: "180connect-gmail-push-staging",
  serviceAccount: "gmail-push-invoker@project.iam.gserviceaccount.com",
};

/** A local stand-in for Google's signing keys, so tokens can be minted in-test. */
async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  async function token(claims: Record<string, unknown> = {}, options: { issuer?: string; audience?: string } = {}) {
    return new SignJWT({ email: config.serviceAccount, email_verified: true, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(options.issuer ?? "https://accounts.google.com")
      .setAudience(options.audience ?? config.audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }
  return { keys, token };
}

const envelope = (payload: unknown) => ({
  message: { data: Buffer.from(JSON.stringify(payload)).toString("base64"), messageId: "1" },
  subscription: "projects/p/subscriptions/s",
});

describe("resolveGmailPushConfig", () => {
  it("requires all three values and a full topic name", () => {
    const full = {
      GMAIL_PUBSUB_TOPIC: "projects/p/topics/gmail-replies",
      GMAIL_PUSH_AUDIENCE: "aud",
      GMAIL_PUSH_SERVICE_ACCOUNT: "SA@p.iam.gserviceaccount.com",
    };
    assert.deepEqual(resolveGmailPushConfig(full), {
      topic: "projects/p/topics/gmail-replies",
      audience: "aud",
      serviceAccount: "sa@p.iam.gserviceaccount.com",
    });
    assert.equal(resolveGmailPushConfig({ ...full, GMAIL_PUSH_AUDIENCE: "" }), null);
    assert.equal(resolveGmailPushConfig({ ...full, GMAIL_PUBSUB_TOPIC: "gmail-replies" }), null);
  });
});

describe("verifyPushToken", () => {
  it("accepts a Google-signed token for our audience and service account", async () => {
    const { keys, token } = await signer();
    assert.equal(await verifyPushToken(`Bearer ${await token()}`, config, keys), true);
  });

  it("rejects a missing or non-bearer header", async () => {
    const { keys } = await signer();
    assert.equal(await verifyPushToken(null, config, keys), false);
    assert.equal(await verifyPushToken("Basic abc", config, keys), false);
  });

  it("rejects another audience, issuer, service account or an unverified email", async () => {
    const { keys, token } = await signer();
    assert.equal(await verifyPushToken(`Bearer ${await token({}, { audience: "someone-else" })}`, config, keys), false);
    assert.equal(await verifyPushToken(`Bearer ${await token({}, { issuer: "https://evil.example" })}`, config, keys), false);
    assert.equal(await verifyPushToken(`Bearer ${await token({ email: "other@p.iam.gserviceaccount.com" })}`, config, keys), false);
    assert.equal(await verifyPushToken(`Bearer ${await token({ email_verified: false })}`, config, keys), false);
  });

  it("rejects a token signed by a key Google did not publish", async () => {
    const { keys } = await signer();
    const forger = await signer();
    assert.equal(await verifyPushToken(`Bearer ${await forger.token()}`, config, keys), false);
  });
});

describe("parsePushNotification", () => {
  it("decodes Gmail's payload out of the Pub/Sub envelope", () => {
    assert.deepEqual(
      parsePushNotification(envelope({ emailAddress: "Clients.Sheffield@180dc.org", historyId: 12345 })),
      { emailAddress: "clients.sheffield@180dc.org", historyId: "12345" },
    );
  });

  it("returns null for anything that is not a Gmail notification", () => {
    assert.equal(parsePushNotification(null), null);
    assert.equal(parsePushNotification({ message: {} }), null);
    assert.equal(parsePushNotification({ message: { data: "not-json" } }), null);
    assert.equal(parsePushNotification(envelope({ historyId: 1 })), null);
  });
});

describe("watchGmailInbox", () => {
  it("watches INBOX only on the configured topic", async () => {
    let sent: { url: string; body: unknown } | null = null;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(input), body: JSON.parse(String(init?.body)) };
      return Response.json({ historyId: "999", expiration: "1790000000000" });
    }) as typeof fetch;
    const result = await watchGmailInbox("projects/p/topics/t", "token", fetchImpl);
    assert.deepEqual(result, { historyId: "999", expiration: "1790000000000" });
    assert.deepEqual(sent, {
      url: "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      body: { topicName: "projects/p/topics/t", labelIds: ["INBOX"], labelFilterBehavior: "include" },
    });
  });

  it("throws when Gmail refuses the watch", async () => {
    const fetchImpl = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;
    await assert.rejects(() => watchGmailInbox("projects/p/topics/t", "token", fetchImpl), /users\.watch failed \(403\)/);
  });
});
