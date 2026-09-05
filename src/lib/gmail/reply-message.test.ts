import assert from "node:assert/strict";
import test from "node:test";
import { isAutomatedInbound, isPotentialCrmReply, matchInboundReply, parseInboundReply, type GmailHeader, type ParsedInboundReply } from "./reply-message.ts";

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
  assert.equal(matchInboundReply({ ...reply, providerThreadId: "unrelated", hasReplyHeaders: false }, [row], "branch@180dc.org"), null);
  assert.equal(matchInboundReply({ ...reply, from: "other@example.org" }, [row], "branch@180dc.org"), null);
  assert.equal(matchInboundReply({ ...reply, to: "personal@180dc.org" }, [row], "branch@180dc.org"), null);
});

test("normalises case, whitespace, and display names in audit-log recipient matching", () => {
  const reply: ParsedInboundReply = {
    providerMessageId: "reply-case", providerThreadId: "thread-case",
    from: "contact@charity.org", to: "branch@180dc.org", subject: "Re: Hello",
    body: "Hello", receivedAt: "2026-08-25T16:00:00.000Z", hasReplyHeaders: true,
  };
  const row = {
    target_id: "outreach-case",
    detail: {
      organisation_id: "org-case", provider_thread_id: "thread-case",
      sent_to: " Charity Contact <CONTACT@CHARITY.ORG> ",
    },
  };

  assert.equal(matchInboundReply(reply, [row], " Branch Mailbox <BRANCH@180DC.ORG> "), row);
});

test("treats only messages connected to CRM outreach as potential replies", () => {
  const reply: ParsedInboundReply = {
    providerMessageId: "reply-relevance", providerThreadId: "different-thread",
    from: "contact@charity.org", to: "branch@180dc.org", subject: "Re: Hello",
    body: "Hello", receivedAt: "2026-08-25T16:00:00.000Z", hasReplyHeaders: true,
  };
  const row = {
    target_id: "outreach-relevance", created_at: "2026-08-25T15:00:00Z",
    detail: {
      organisation_id: "org-relevance", provider_thread_id: "crm-thread",
      sent_to: "Charity Contact <CONTACT@CHARITY.ORG>",
    },
  };

  assert.equal(isPotentialCrmReply(reply, [row], "branch@180dc.org"), true);
  assert.equal(isPotentialCrmReply({ ...reply, from: "unrelated@example.org" }, [row], "branch@180dc.org"), false);
  assert.equal(isPotentialCrmReply({ ...reply, hasReplyHeaders: false }, [row], "branch@180dc.org"), false);
});

test("falls back to a unique client email match but flags ambiguous senders", () => {
  const reply: ParsedInboundReply = {
    providerMessageId: "reply-2", providerThreadId: "provider-thread-drifted",
    from: "shared@charity.org", to: "branch@180dc.org", subject: "Re: Hello",
    body: "Following up", receivedAt: "2026-08-26T10:00:00.000Z", hasReplyHeaders: true,
  };
  const newest = {
    target_id: "outreach-2", created_at: "2026-08-25T10:00:00Z",
    detail: { organisation_id: "org-1", provider_thread_id: "old-2", sent_to: "shared@charity.org" },
  };
  const older = {
    target_id: "outreach-1", created_at: "2026-08-20T10:00:00Z",
    detail: { organisation_id: "org-1", provider_thread_id: "old-1", sent_to: "shared@charity.org" },
  };
  assert.equal(matchInboundReply(reply, [older, newest], "branch@180dc.org"), newest);
  assert.equal(matchInboundReply({ ...reply, hasReplyHeaders: false }, [newest], "branch@180dc.org"), null);

  const anotherClient = {
    target_id: "outreach-3", created_at: "2026-08-26T09:00:00Z",
    detail: { organisation_id: "org-2", provider_thread_id: "old-3", sent_to: "shared@charity.org" },
  };
  assert.equal(matchInboundReply(reply, [newest, anotherClient], "branch@180dc.org"), null);
});
