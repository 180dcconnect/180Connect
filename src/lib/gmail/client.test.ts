import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveGmailConfig, sendGmailMessage } from "./client.ts";

const config = { clientId: "client", clientSecret: "secret", refreshToken: "refresh" };

describe("resolveGmailConfig", () => {
  it("fails closed when any server credential is absent", () => {
    assert.equal(resolveGmailConfig({ GMAIL_CLIENT_ID: "client" }), null);
  });
});

describe("sendGmailMessage", () => {
  it("returns Gmail message and thread identifiers", async () => {
    const result = await sendGmailMessage(
      { from: "clients.sheffield@180dc.org", to: "charity@example.org", subject: "Hello", text: "Body" },
      {
        config,
        fetchImpl: async (_input, init) => {
          assert.match(String(new Headers(init?.headers).get("Authorization")), /^Bearer /);
          const request = JSON.parse(String(init?.body)) as { raw: string };
          assert.ok(request.raw.length > 10);
          return Response.json({ id: "gmail-message", threadId: "gmail-thread" });
        },
      },
    );
    assert.deepEqual(result, { ok: true, providerMessageId: "gmail-message", providerThreadId: "gmail-thread" });
  });

  it("fails clearly when Gmail authentication is rejected", async () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      const result = await sendGmailMessage(
        { from: "clients.sheffield@180dc.org", to: "charity@example.org", subject: "Hello", text: "Body" },
        { config, fetchImpl: async () => Response.json({}, { status: 401 }) },
      );
      assert.deepEqual(result, { ok: false, retryable: false, reason: "The Gmail connection needs to be re-authorised." });
    } finally {
      console.error = original;
    }
  });
});
