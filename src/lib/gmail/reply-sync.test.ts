import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGmailReplyLookbackDays, syncGmailReplies } from "./reply-sync.ts";
import type { GmailInboundMessage } from "./reply-message.ts";

const config = { clientId: "client", clientSecret: "secret", refreshToken: "refresh" };
const sender = "branch@180dc.org";
const tokenProvider = () => Promise.resolve("test-access-token");

/** reportError degrades to console.error when Sentry is unconfigured; keep test output clean. */
async function quiet<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

const encoded = (value: string) => Buffer.from(value).toString("base64url");

function inboundMessage(overrides: Partial<GmailInboundMessage> & { from?: string; subject?: string; body?: string } = {}): GmailInboundMessage {
  const { from = "contact@charity.org", subject = "Re: Partnership", body = "Yes, let's talk.", ...rest } = overrides;
  return {
    id: "gmail-1",
    threadId: "thread-1",
    internalDate: "1787673600000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: sender },
        { name: "Subject", value: subject },
        { name: "In-Reply-To", value: "<sent@example>" },
      ],
      body: { data: encoded(body) },
    },
    ...rest,
  };
}

/** Only what syncGmailReplies actually calls on the Gmail messages.list/get endpoints. */
function fetchStub(messages: Record<string, GmailInboundMessage | "missing">): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/messages?")) {
      return Response.json({ messages: Object.keys(messages).map((id) => ({ id })) });
    }
    const match = url.match(/\/messages\/([^?]+)/);
    const id = match ? decodeURIComponent(match[1]) : "";
    const message = messages[id];
    if (!message || message === "missing") return new Response("not found", { status: 404 });
    return Response.json(message);
  }) as typeof fetch;
}

type SentRow = { target_id: string; created_at?: string; detail: Record<string, unknown> };

/** Minimal admin double covering exactly the two calls syncGmailReplies makes. */
function fakeAdmin(options: {
  sentRows?: SentRow[];
  rpcResults?: Record<string, unknown[]>;
}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const queues: Record<string, unknown[]> = {};
  for (const [name, results] of Object.entries(options.rpcResults ?? {})) queues[name] = [...results];

  const admin = {
    from(table: string) {
      if (table !== "audit_log") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                eq: () => Promise.resolve({ data: options.sentRows ?? [], error: null }),
              };
            },
          };
        },
      };
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      const next = queues[name]?.shift();
      if (next instanceof Error) return Promise.resolve({ data: null, error: { message: next.message } });
      return Promise.resolve({ data: next ?? null, error: null });
    },
  };
  return { admin: admin as unknown as SupabaseClient, rpcCalls };
}

describe("syncGmailReplies", () => {
  it("uses a configurable positive reply lookback with a two-day default", () => {
    assert.equal(resolveGmailReplyLookbackDays({}), 2);
    assert.equal(resolveGmailReplyLookbackDays({ GMAIL_REPLY_LOOKBACK_DAYS: "30" }), 30);
    assert.equal(resolveGmailReplyLookbackDays({ GMAIL_REPLY_LOOKBACK_DAYS: "0" }), 2);
    assert.equal(resolveGmailReplyLookbackDays({ GMAIL_REPLY_LOOKBACK_DAYS: "not-a-number" }), 2);
  });

  it("captures a reply that matches a sent thread and sender", async () => {
    const { admin, rpcCalls } = fakeAdmin({
      sentRows: [{ target_id: "outreach-1", detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "contact@charity.org" } }],
      rpcResults: { capture_gmail_reply: ["reply-id-1"] },
    });
    const result = await syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({ "gmail-1": inboundMessage() }),
    });
    assert.deepEqual(result, { scanned: 1, captured: 1, duplicates: 0, ignored: 0, unmatched: 0, failed: 0 });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, "capture_gmail_reply");
    assert.equal(rpcCalls[0].args.p_outreach_message_id, "outreach-1");
    assert.equal(rpcCalls[0].args.p_organisation_id, "org-1");
  });

  it("flags a CRM-related reply that cannot be matched safely for manual review", async () => {
    const { admin, rpcCalls } = fakeAdmin({
      sentRows: [{ target_id: "outreach-1", detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "another@charity.org" } }],
      rpcResults: { flag_unmatched_gmail_reply: ["review-id-1"] },
    });
    const result = await syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({ "gmail-1": inboundMessage() }),
    });
    assert.deepEqual(result, { scanned: 1, captured: 0, duplicates: 0, ignored: 0, unmatched: 1, failed: 0 });
    assert.equal(rpcCalls[0].name, "flag_unmatched_gmail_reply");
    assert.equal(rpcCalls[0].args.p_sender_email, "contact@charity.org");
  });

  it("ignores genuine inbox mail that has no connection to CRM outreach", async () => {
    const { admin, rpcCalls } = fakeAdmin({ sentRows: [] });
    const result = await syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({ "gmail-1": inboundMessage() }),
    });
    assert.deepEqual(result, { scanned: 1, captured: 0, duplicates: 0, ignored: 1, unmatched: 0, failed: 0 });
    assert.equal(rpcCalls.length, 0);
  });

  it("counts a replayed capture as a duplicate, not a capture", async () => {
    const { admin } = fakeAdmin({
      sentRows: [{ target_id: "outreach-1", detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "contact@charity.org" } }],
      rpcResults: { capture_gmail_reply: [null] },
    });
    const result = await syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({ "gmail-1": inboundMessage() }),
    });
    assert.deepEqual(result, { scanned: 1, captured: 0, duplicates: 1, ignored: 0, unmatched: 0, failed: 0 });
  });

  it("counts a replayed unmatched flag as a duplicate too", async () => {
    const { admin } = fakeAdmin({
      sentRows: [{ target_id: "outreach-1", detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "another@charity.org" } }],
      rpcResults: { flag_unmatched_gmail_reply: [null] },
    });
    const result = await syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({ "gmail-1": inboundMessage() }),
    });
    assert.deepEqual(result, { scanned: 1, captured: 0, duplicates: 1, ignored: 0, unmatched: 0, failed: 0 });
  });

  it("ignores an automated bounce without calling either RPC", async () => {
    const { admin, rpcCalls } = fakeAdmin({ sentRows: [] });
    const result = await syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({ "gmail-1": inboundMessage({ from: "MAILER-DAEMON@example.org" }) }),
    });
    assert.deepEqual(result, { scanned: 1, captured: 0, duplicates: 0, ignored: 1, unmatched: 0, failed: 0 });
    assert.equal(rpcCalls.length, 0);
  });

  it("isolates a per-message failure so the rest of the batch still processes", async () => {
    const { admin } = fakeAdmin({
      sentRows: [{ target_id: "outreach-1", detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "contact@charity.org" } }],
      rpcResults: { capture_gmail_reply: ["reply-id-1"] },
    });
    const result = await quiet(() => syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({
        "gmail-broken": "missing",
        "gmail-1": inboundMessage(),
      }),
    }));
    assert.deepEqual(result, { scanned: 2, captured: 1, duplicates: 0, ignored: 0, unmatched: 0, failed: 1 });
  });

  it("throws when the reply sync is not configured", async () => {
    // No config override: falls through to resolveGmailConfig() against the
    // real (unset in tests) GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN env vars,
    // same convention as client.test.ts's equivalent case.
    await assert.rejects(
      () => syncGmailReplies({ admin: fakeAdmin({}).admin, sender, tokenProvider } as Parameters<typeof syncGmailReplies>[0]),
      /not configured/,
    );
  });
});
