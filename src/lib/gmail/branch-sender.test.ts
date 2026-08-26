import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sendBranchOutreach } from "./branch-sender.ts";

const complete = {
  GMAIL_CLIENT_ID: "client",
  GMAIL_CLIENT_SECRET: "secret",
  GMAIL_REFRESH_TOKEN: "refresh",
  GMAIL_SENDER_EMAIL: "CLIENTS.SHEFFIELD@180DC.ORG",
};

describe("sendBranchOutreach", () => {
  it("always supplies the configured branch mailbox as sender", async () => {
    let from = "";
    const result = await sendBranchOutreach(
      { to: "charity@example.org", subject: "Hello", text: "Body" },
      {
        source: complete,
        send: async (message) => {
          from = message.from;
          return { ok: true, providerMessageId: "m1", providerThreadId: "t1" };
        },
      },
    );
    assert.equal(from, "180 Degrees Sheffield <clients.sheffield@180dc.org>");
    assert.equal(result.ok, true);
  });

  it("passes the sanitized HTML body through to the transport", async () => {
    let html: string | undefined;
    await sendBranchOutreach(
      { to: "charity@example.org", subject: "Hello", text: "Body", html: "<p>Body</p>" },
      {
        source: complete,
        send: async (message) => {
          html = message.html;
          return { ok: true, providerMessageId: "m1", providerThreadId: "t1" };
        },
      },
    );
    assert.equal(html, "<p>Body</p>");
  });

  it("fails closed instead of selecting a fallback sender", async () => {
    let called = false;
    const result = await sendBranchOutreach(
      { to: "charity@example.org", subject: "Hello", text: "Body" },
      {
        source: { ...complete, GMAIL_SENDER_EMAIL: "" },
        send: async () => {
          called = true;
          return { ok: true, providerMessageId: "m1", providerThreadId: "t1" };
        },
      },
    );
    assert.equal(called, false);
    assert.deepEqual(result, {
      ok: false,
      retryable: false,
      reason: "The branch outreach mailbox is not configured.",
    });
  });
});
