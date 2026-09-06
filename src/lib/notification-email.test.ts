import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sendNotificationEmail } from "./notification-email.ts";

const complete = {
  GMAIL_CLIENT_ID: "client",
  GMAIL_CLIENT_SECRET: "secret",
  GMAIL_REFRESH_TOKEN: "refresh",
  GMAIL_SENDER_EMAIL: "CLIENTS.SHEFFIELD@180DC.ORG",
};

describe("sendNotificationEmail (F179 AC2)", () => {
  it("sends from the configured branch mailbox under a 180Connect display name, not the outreach one", async () => {
    let from = "";
    const result = await sendNotificationEmail(
      { to: "cam@180dc.org", subject: "You have a reply", text: "Body" },
      {
        source: complete,
        send: async (message) => {
          from = message.from;
          return { ok: true, providerMessageId: "m1", providerThreadId: "t1" };
        },
      },
    );
    assert.equal(from, "180Connect <clients.sheffield@180dc.org>");
    assert.equal(result.ok, true);
  });

  it("passes the recipient, subject and body straight through to the transport", async () => {
    let captured: { to: string; subject: string; text: string } | null = null;
    await sendNotificationEmail(
      { to: "cam@180dc.org", subject: "You have a reply", text: "Someone replied." },
      {
        source: complete,
        send: async (message) => {
          captured = { to: message.to, subject: message.subject, text: message.text };
          return { ok: true, providerMessageId: "m1", providerThreadId: "t1" };
        },
      },
    );
    assert.deepEqual(captured, {
      to: "cam@180dc.org",
      subject: "You have a reply",
      text: "Someone replied.",
    });
  });

  it("fails closed instead of falling back to an unconfigured or default sender", async () => {
    let called = false;
    const result = await sendNotificationEmail(
      { to: "cam@180dc.org", subject: "Hello", text: "Body" },
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
      reason: "Email notifications are not configured.",
    });
  });
});
