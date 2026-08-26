import assert from "node:assert/strict";
import test from "node:test";
import { isAutomatedInbound, matchInboundReply, parseInboundReply, type GmailHeader, type ParsedInboundReply } from "./reply-message.ts";

const encoded = (value: string) => Buffer.from(value).toString("base64url");
const headers = (extra: GmailHeader[] = []): GmailHeader[] => [
  { name: "From", value: "Charity Contact <contact@charity.org>" },
  { name: "To", value: "branch@180dc.org" },
  { name: "Subject", value: "Re: Partnership" },
  { name: "In-Reply-To", value: "<sent@example>" },
  ...extra,
];

test("parses a genuine plain-text reply", () => {
  const parsed = parseInboundReply({
    id: "gmail-1",
    threadId: "thread-1",
    internalDate: "1787673600000",
    payload: { mimeType: "text/plain", headers: headers(), body: { data: encoded("Yes, let's talk.\r\n") } },
  });
  assert.deepEqual(parsed, {
    providerMessageId: "gmail-1",
    providerThreadId: "thread-1",
    from: "contact@charity.org",
    to: "branch@180dc.org",
    subject: "Re: Partnership",
    body: "Yes, let's talk.",
    receivedAt: "2026-08-25T16:00:00.000Z",
    hasReplyHeaders: true,
  });
});

test("rejects bounce and out-of-office signals", () => {
  assert.equal(isAutomatedInbound(headers([{ name: "Auto-Submitted", value: "auto-replied" }])), true);
  assert.equal(isAutomatedInbound([
    ...headers().filter((item) => item.name !== "Subject"),
    { name: "Subject", value: "Automatic reply: Partnership" },
  ]), true);
  assert.equal(isAutomatedInbound([{ name: "From", value: "MAILER-DAEMON@example.org" }]), true);
});

test("uses HTML only when no plain part exists", () => {
  const parsed = parseInboundReply({
    id: "gmail-2",
    threadId: "thread-2",
    internalDate: "1787673600000",
    payload: { mimeType: "text/html", headers: headers(), body: { data: encoded("<p>Interested &amp; available.</p>") } },
  });
  assert.equal(parsed?.body, "Interested & available.");
});

test("matches only the sent thread, branch recipient, and client sender", () => {
  const reply: ParsedInboundReply = {
    providerMessageId: "reply-1", providerThreadId: "thread-1",
    from: "contact@charity.org", to: "branch@180dc.org", subject: "Re: Hello",
    body: "Hello", receivedAt: "2026-08-25T16:00:00.000Z", hasReplyHeaders: true,
  };
  const row = {
    target_id: "outreach-1",
    detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "contact@charity.org" },
  };
  assert.equal(matchInboundReply(reply, [row], "branch@180dc.org"), row);
  assert.equal(matchInboundReply({ ...reply, providerThreadId: "unrelated" }, [row], "branch@180dc.org"), null);
  assert.equal(matchInboundReply({ ...reply, from: "other@example.org" }, [row], "branch@180dc.org"), null);
  assert.equal(matchInboundReply({ ...reply, to: "personal@180dc.org" }, [row], "branch@180dc.org"), null);
});
