import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resolveGmailConfig, sendGmailMessage } from "./client.ts";

const config = { clientId: "client", clientSecret: "secret", refreshToken: "refresh" };
const message = {
  from: "clients.sheffield@180dc.org",
  to: "charity@example.org",
  subject: "Hello",
  text: "Body",
};

/** reportError degrades to console.error when Sentry is unconfigured; keep test output clean. */
async function quiet(run: () => Promise<void>) {
  const original = console.error;
  console.error = () => undefined;
  try {
    await run();
  } finally {
    console.error = original;
  }
}

function okSend(overrides: Record<string, unknown> = {}) {
  return async () => Response.json({ id: "gmail-message", threadId: "gmail-thread", ...overrides });
}

const tokenProvider = () => Promise.resolve("test-access-token");

afterEach(() => {
  delete process.env.GMAIL_SENDER_EMAIL;
});

describe("resolveGmailConfig", () => {
  it("fails closed when any server credential is absent", () => {
    assert.equal(resolveGmailConfig({ GMAIL_CLIENT_ID: "client" }), null);
  });
});

describe("sendGmailMessage", () => {
  it("returns Gmail message and thread identifiers", async () => {
    const result = await sendGmailMessage(message, {
      config,
      tokenProvider,
      fetchImpl: async (_input, init) => {
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-access-token");
        const request = JSON.parse(String(init?.body)) as { raw: string };
        assert.ok(request.raw.length > 10);
        return okSend()();
      },
    });
    assert.deepEqual(result, { ok: true, providerMessageId: "gmail-message", providerThreadId: "gmail-thread" });
  });

  it("fails closed without a complete configuration", async () => {
    await quiet(async () => {
      const result = await sendGmailMessage(message, {});
      assert.deepEqual(result, { ok: false, retryable: false, reason: "Gmail is not configured." });
    });
  });

  it("refuses to send as an identity other than the configured branch mailbox", async () => {
    process.env.GMAIL_SENDER_EMAIL = "clients.sheffield@180dc.org";
    await quiet(async () => {
      const result = await sendGmailMessage(
        { ...message, from: "someone-else@evil.example" },
        { config, tokenProvider, fetchImpl: async () => { throw new Error("must not be called"); } },
      );
      assert.equal(result.ok, false);
      assert.equal(result.retryable, false);
    });
  });

  it("accepts a display-name From header that matches the branch mailbox", async () => {
    process.env.GMAIL_SENDER_EMAIL = "clients.sheffield@180dc.org";
    const result = await sendGmailMessage(
      { ...message, from: "180 Degrees Sheffield <clients.sheffield@180dc.org>" },
      { config, tokenProvider, fetchImpl: okSend() },
    );
    assert.equal(result.ok, true);
  });

  it("fails clearly when Gmail authentication is rejected at the API", async () => {
    await quiet(async () => {
      const result = await sendGmailMessage(message, {
        config,
        tokenProvider,
        fetchImpl: async () => Response.json({}, { status: 401 }),
      });
      assert.deepEqual(result, { ok: false, retryable: false, reason: "The Gmail connection needs to be re-authorised." });
    });
  });

  it("reports a revoked refresh token as re-authorisation, not a retryable outage", async () => {
    await quiet(async () => {
      // Exercises the real OAuth phase end-to-end: the token endpoint answers
      // 400 invalid_grant, the shape Google returns for revoked credentials.
      const result = await sendGmailMessage(message, {
        config,
        fetchImpl: async (input) => {
          assert.equal(String(input), "https://oauth2.googleapis.com/token");
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        },
      });
      assert.deepEqual(result, { ok: false, retryable: false, reason: "The Gmail connection needs to be re-authorised." });
    });
  });

  it("treats a token-endpoint outage as retryable unavailability", async () => {
    await quiet(async () => {
      const result = await sendGmailMessage(message, {
        config,
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        },
      });
      assert.deepEqual(result, { ok: false, retryable: true, reason: "Gmail is temporarily unavailable. Try again." });
    });
  });
  it("marks rate limiting (429) as retryable", async () => {
    await quiet(async () => {
      const result = await sendGmailMessage(message, {
        config,
        tokenProvider,
        fetchImpl: async () => Response.json({}, { status: 429 }),
      });
      assert.deepEqual(result, { ok: false, retryable: true, reason: "Gmail could not send the email. Try again." });
    });
  });

  it("marks server errors (5xx) as retryable downtime", async () => {
    await quiet(async () => {
      const result = await sendGmailMessage(message, {
        config,
        tokenProvider,
        fetchImpl: async () => Response.json({ error: { code: 500 } }, { status: 500 }),
      });
      assert.deepEqual(result, { ok: false, retryable: true, reason: "Gmail could not send the email. Try again." });
    });
  });

  it("does not risk a duplicate send when a success response is malformed", async () => {
    await quiet(async () => {
      const result = await sendGmailMessage(message, {
        config,
        tokenProvider,
        // 200 but unparsable/truncated body: the message may actually have been
        // delivered, so this must never come back as "safe to retry".
        fetchImpl: async () => new Response("<html>gateway noise</html>", { status: 200 }),
      });
      assert.equal(result.ok, false);
      assert.equal(result.retryable, false);
    });
  });

  it("treats a network failure at the send call as retryable downtime", async () => {
    await quiet(async () => {
      const result = await sendGmailMessage(message, {
        config,
        tokenProvider,
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        },
      });
      assert.deepEqual(result, { ok: false, retryable: true, reason: "Gmail is temporarily unavailable. Try again." });
    });
  });
});
