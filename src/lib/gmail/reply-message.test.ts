import assert from "node:assert/strict";
import test from "node:test";
import { isAutomatedInbound, isPotentialCrmReply, matchInboundReply, parseInboundReply, stripQuotedReply, type GmailHeader, type ParsedInboundReply } from "./reply-message.ts";

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

test("strips a Gmail HTML quote even when it sits in a bare div, not a <p>", () => {
  // Gmail wraps quoted history in <div class="gmail_quote">, not <p> — with no
  // newline inserted at the div boundary, the "From: ..." line runs onto the
  // client's own last line and stripQuotedReply's line-anchored regex never
  // sees it as its own line.
  const parsed = parseInboundReply({
    id: "gmail-3",
    threadId: "thread-3",
    internalDate: "1787673600000",
    payload: {
      mimeType: "text/html",
      headers: headers(),
      body: {
        data: encoded(
          '<div dir="ltr">Yes please, that works for us.</div>' +
            '<div class="gmail_quote">' +
            "From: 180 Degrees Sheffield &lt;clients.sheffield@180dc.org&gt;<br>" +
            "To: contact@charity.org<br>" +
            "Subject: Partnership<br><br>" +
            "Dear team, we are writing to introduce ourselves." +
            "</div>",
        ),
      },
    },
  });
  assert.equal(parsed?.body, "Yes please, that works for us.");
});

// ---------------------------------------------------------------------------
// Quoted history. A reply carries our own previous email underneath it, and
// that text used to reach the drafting prompt as "the client's reply".
// ---------------------------------------------------------------------------

test("strips a Gmail-style quoted chain, keeping the client's own words", () => {
  const stripped = stripQuotedReply(
    [
      "Thanks for reaching out — we would be interested in a call.",
      "",
      "Best,",
      "Sarah",
      "",
      "On Mon, 8 Sep 2026 at 10:00, Marissa Law <marissa@180dc.org> wrote:",
      "> Hi Sarah,",
      "> I am reaching out about a possible collaboration.",
    ].join("\n"),
  );

  assert.match(stripped, /we would be interested in a call/);
  assert.doesNotMatch(stripped, /On Mon, 8 Sep/);
  assert.doesNotMatch(stripped, /I am reaching out about/);
});

test("strips a quoted chain whose Gmail attribution line wrapped", () => {
  // Gmail's text/plain part hard-wraps at ~76 characters, so a long sender
  // name and address split "On ... wrote:" across two lines. Seen on staging.
  const stripped = stripQuotedReply(
    [
      "Sounds good, Tuesday works for us.",
      "",
      "On Mon, Sep 14, 2026 at 3:51 PM 180 Degrees Sheffield <",
      "clients.sheffield@180dc.org> wrote:",
      "",
      "> Hi Sarah,",
      "> Would Tuesday suit you?",
      "",
      "--",
      "Email <sheffield@180dc.org> - Website <https://www.180dc.org/>",
    ].join("\n"),
  );

  assert.equal(stripped, "Sounds good, Tuesday works for us.");
});

test("does not cut at a sentence that merely starts with On", () => {
  const plain = "On Tuesday we are free.\nPlease send a calendar invite.\nThanks";
  assert.equal(stripQuotedReply(plain), plain);
});

test("keeps an inline reply that sits below quoted lines", () => {
  // The reason this cuts at an attribution header and then drops quoted lines,
  // rather than cutting at the first ">": an inline reply interleaves, and
  // truncating there would throw away everything they wrote underneath it.
  const stripped = stripQuotedReply(
    [
      "My answers are inline below.",
      "> What is your budget?",
      "About £5k for this year.",
      "> When would you start?",
      "After our trustees meet in October.",
    ].join("\n"),
  );

  assert.match(stripped, /My answers are inline below\./);
  assert.match(stripped, /About £5k for this year\./);
  assert.match(stripped, /After our trustees meet in October\./);
  assert.doesNotMatch(stripped, /What is your budget\?/);
});

test("strips Outlook's separator and forwarded-header block", () => {
  const stripped = stripQuotedReply(
    [
      "Happy to help — see my colleague below.",
      "________________________________",
      "From: Marissa Law",
      "Sent: Monday, 8 September 2026",
      "To: Sarah",
      "Subject: Partnership",
      "",
      "Hi Sarah, I am reaching out about a possible collaboration.",
    ].join("\n"),
  );

  assert.match(stripped, /Happy to help/);
  assert.doesNotMatch(stripped, /I am reaching out about/);
  assert.doesNotMatch(stripped, /Marissa Law/);
});

test("resolves the original-message header form too", () => {
  const stripped = stripQuotedReply(
    "Yes please.\n\n-----Original Message-----\nFrom: branch@180dc.org\nOur original email.",
  );
  assert.equal(stripped, "Yes please.");
});

test("never empties a reply, even one that is nothing but a quotation", () => {
  // A missed reply is worse than a noisy one: an empty-body message is dropped
  // entirely by parseInboundReply, so stripping must not be able to produce one.
  const onlyQuoted = ["On Mon, 8 Sep 2026 at 10:00, Marissa Law wrote:", "> Hi Sarah,", "> Reaching out."].join("\n");
  assert.equal(stripQuotedReply(onlyQuoted), onlyQuoted);
  assert.equal(stripQuotedReply("> only a quote"), "> only a quote");
});

test("leaves a reply with no quoted history exactly as written", () => {
  const plain = "Yes, that works for us.\n\nBest,\nSarah";
  assert.equal(stripQuotedReply(plain), plain);
});

test("parseInboundReply hands on the client's words without the quotation", () => {
  const parsed = parseInboundReply({
    id: "gmail-9",
    threadId: "thread-9",
    internalDate: "1787673600000",
    payload: {
      mimeType: "text/plain",
      headers: headers(),
      body: { data: encoded("Interested.\n\nOn Mon, 8 Sep 2026 at 10:00, Marissa Law wrote:\n> Hi Sarah,\n> Reaching out.") },
    },
  });
  assert.equal(parsed?.body, "Interested.");
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
