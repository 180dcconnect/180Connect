import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { resolveEmailConfig, sendEmail, type EmailConfig } from "./send.ts";

const message = {
  to: "ben@180dc.org",
  subject: "You have been invited to 180 Connect",
  text: "Follow the link to set your password.",
};

const resendConfig: EmailConfig = {
  transport: "resend",
  apiKey: "re_test_key",
  from: "180 Connect <no-reply@example.com>",
  allowlist: [],
};

/** Silences the transport's own logging for the duration of one test. */
function withSilencedConsole<T>(run: () => Promise<T>): Promise<T> {
  const info = mock.method(console, "info", () => {});
  const warn = mock.method(console, "warn", () => {});
  const error = mock.method(console, "error", () => {});
  return run().finally(() => {
    info.mock.restore();
    warn.mock.restore();
    error.mock.restore();
  });
}

/** Replaces `fetch` with a stub, restoring it afterwards. */
function withFetch<T>(
  handler: (input: string, init: RequestInit) => Response,
  run: (calls: Array<{ url: string; init: RequestInit }>) => Promise<T>,
): Promise<T> {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("resolveEmailConfig", () => {
  it("falls back to the console transport when no API key is set", () => {
    const config = resolveEmailConfig({});
    assert.equal(config.transport, "console");
    assert.deepEqual(config.allowlist, []);
  });

  it("selects Resend when an API key is present", () => {
    const config = resolveEmailConfig({
      RESEND_API_KEY: "re_abc123",
      EMAIL_FROM: "180 Connect <no-reply@example.com>",
      EMAIL_RECIPIENT_ALLOWLIST: "180dc.org",
    });
    assert.equal(config.transport, "resend");
    assert.equal(config.apiKey, "re_abc123");
    assert.deepEqual(config.allowlist, ["180dc.org"]);
  });

  it("treats a blank API key as absent", () => {
    assert.equal(resolveEmailConfig({ RESEND_API_KEY: "   " }).transport, "console");
  });
});

describe("sendEmail", () => {
  it("logs instead of sending when no transport is configured", async () => {
    const result = await withSilencedConsole(() =>
      sendEmail(message, { transport: "console", from: "", allowlist: [] }),
    );
    assert.equal(result.status, "skipped");
    assert.match(result.status === "skipped" ? result.reason : "", /RESEND_API_KEY/);
  });

  it("posts to Resend and returns the provider's id", async () => {
    const result = await withFetch(
      () => jsonResponse(200, { id: "b1f2-3456" }),
      async (calls) => {
        const sent = await sendEmail(message, resendConfig);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "https://api.resend.com/emails");

        const headers = calls[0].init.headers as Record<string, string>;
        assert.equal(headers.Authorization, "Bearer re_test_key");

        const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
        assert.equal(body.from, resendConfig.from);
        assert.deepEqual(body.to, ["ben@180dc.org"]);
        assert.equal(body.subject, message.subject);
        return sent;
      },
    );

    assert.equal(result.status, "sent");
    assert.equal(result.status === "sent" && result.id, "b1f2-3456");
  });

  it("sends replyTo under Resend's reply_to field", async () => {
    await withFetch(
      () => jsonResponse(200, { id: "id" }),
      async (calls) => {
        await sendEmail({ ...message, replyTo: "cam@180dc.org" }, resendConfig);
        const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
        assert.equal(body.reply_to, "cam@180dc.org");
      },
    );
  });

  it("surfaces the provider's explanation when it rejects the message", async () => {
    const result = await withSilencedConsole(() =>
      withFetch(
        () =>
          jsonResponse(403, {
            name: "validation_error",
            message: "The example.com domain is not verified.",
          }),
        () => sendEmail(message, resendConfig),
      ),
    );
    assert.equal(result.status, "failed");
    assert.match(result.status === "failed" ? result.reason : "", /not verified/);
  });

  it("fails without throwing when the provider is unreachable", async () => {
    const result = await withSilencedConsole(() =>
      withFetch(
        () => {
          throw new Error("network down");
        },
        () => sendEmail(message, resendConfig),
      ),
    );
    assert.equal(result.status, "failed");
  });

  it("refuses to send when EMAIL_FROM is unset", async () => {
    const result = await withSilencedConsole(() =>
      withFetch(
        () => jsonResponse(200, { id: "id" }),
        async (calls) => {
          const sent = await sendEmail(message, { ...resendConfig, from: "" });
          assert.equal(calls.length, 0, "must not reach the provider");
          return sent;
        },
      ),
    );
    assert.equal(result.status, "failed");
    assert.match(result.status === "failed" ? result.reason : "", /EMAIL_FROM/);
  });

  it("fails a malformed message before any network call", async () => {
    const result = await withSilencedConsole(() =>
      withFetch(
        () => jsonResponse(200, { id: "id" }),
        async (calls) => {
          const sent = await sendEmail({ ...message, to: "nope" }, resendConfig);
          assert.equal(calls.length, 0, "must not reach the provider");
          return sent;
        },
      ),
    );
    assert.equal(result.status, "failed");
  });

  it("drops recipients the allowlist does not permit, and sends to the rest", async () => {
    const config: EmailConfig = { ...resendConfig, allowlist: ["180dc.org"] };
    await withSilencedConsole(() =>
      withFetch(
        () => jsonResponse(200, { id: "id" }),
        async (calls) => {
          const sent = await sendEmail(
            { ...message, to: ["ben@180dc.org", "trustee@a-real-charity.org.uk"] },
            config,
          );
          assert.equal(sent.status, "sent");
          const body = JSON.parse(String(calls[0].init.body)) as { to: string[] };
          assert.deepEqual(body.to, ["ben@180dc.org"]);
        },
      ),
    );
  });

  it("sends nothing when the allowlist blocks every recipient", async () => {
    const config: EmailConfig = { ...resendConfig, allowlist: ["180dc.org"] };
    const result = await withSilencedConsole(() =>
      withFetch(
        () => jsonResponse(200, { id: "id" }),
        async (calls) => {
          const sent = await sendEmail(
            { ...message, to: "trustee@a-real-charity.org.uk" },
            config,
          );
          assert.equal(calls.length, 0, "must not reach the provider");
          return sent;
        },
      ),
    );
    assert.equal(result.status, "skipped");
    assert.match(result.status === "skipped" ? result.reason : "", /ALLOWLIST/);
  });
});
