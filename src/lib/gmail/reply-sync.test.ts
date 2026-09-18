import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyReplyOwnerByEmail, resolveGmailReplyLookbackDays, syncGmailReplies } from "./reply-sync.ts";
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

type OrgRow = { owner_id: string | null; legal_name: string };
type UserRow = { email: string; is_active: boolean; email_notification_types: string[] | null };

/** Minimal admin double covering the calls syncGmailReplies and its F179 notify make. */
function fakeAdmin(options: {
  sentRows?: SentRow[];
  organisation?: OrgRow | null;
  user?: UserRow | null;
  rpcResults?: Record<string, unknown[]>;
  /** Gmail ids audit_log already records as gmail_reply_captured. */
  capturedIds?: string[];
}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const queues: Record<string, unknown[]> = {};
  for (const [name, results] of Object.entries(options.rpcResults ?? {})) queues[name] = [...results];

  const admin = {
    from(table: string) {
      if (table === "audit_log") {
        return {
          select(columns: string) {
            if (columns === "detail") {
              return {
                eq: () => ({
                  in: () => Promise.resolve({
                    data: (options.capturedIds ?? []).map((id) => ({ detail: { provider_message_id: id } })),
                    error: null,
                  }),
                }),
              };
            }
            return {
              eq() {
                return {
                  eq: () => Promise.resolve({ data: options.sentRows ?? [], error: null }),
                };
              },
            };
          },
        };
      }
      if (table === "organisations" || table === "users") {
        const row = table === "organisations" ? options.organisation : options.user;
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () => Promise.resolve({ data: row ?? null, error: null }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
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

type SentCall = { to: string; subject: string; text: string };

async function sendStub(sends: SentCall[]) {
  return async (input: { to: string; subject: string; text: string }) => {
    sends.push(input);
    return { ok: true, providerMessageId: "m1", providerThreadId: "t1" } as const;
  };
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

  it("emails the owning CAM after a capture when their preferences opt in (F179)", async () => {
    const sends: SentCall[] = [];
    const { admin, rpcCalls } = fakeAdmin({
      sentRows: [{ target_id: "outreach-1", detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "contact@charity.org" } }],
      rpcResults: { capture_gmail_reply: ["reply-id-1"] },
      organisation: { owner_id: "user-1", legal_name: "Charity Ltd" },
      user: { email: "cam@180dc.org", is_active: true, email_notification_types: ["client_reply_received"] },
    });
    const result = await syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({ "gmail-1": inboundMessage() }),
      sendNotification: await sendStub(sends),
    });
    assert.deepEqual(result, { scanned: 1, captured: 1, duplicates: 0, ignored: 0, unmatched: 0, failed: 0 });
    assert.equal(rpcCalls.length, 1);
    assert.deepEqual(sends, [{ to: "cam@180dc.org", subject: "Charity Ltd replied", text: "Yes, let's talk." }]);
  });

  it("never emails a replayed capture (F179 duplicate handling)", async () => {
    const sends: SentCall[] = [];
    const { admin } = fakeAdmin({
      sentRows: [{ target_id: "outreach-1", detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "contact@charity.org" } }],
      rpcResults: { capture_gmail_reply: [null] },
      organisation: { owner_id: "user-1", legal_name: "Charity Ltd" },
      user: { email: "cam@180dc.org", is_active: true, email_notification_types: ["client_reply_received"] },
    });
    const result = await syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({ "gmail-1": inboundMessage() }),
      sendNotification: await sendStub(sends),
    });
    assert.deepEqual(result, { scanned: 1, captured: 0, duplicates: 1, ignored: 0, unmatched: 0, failed: 0 });
    assert.deepEqual(sends, []);
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

  it("does not email a reply when the capture RPC itself failed", async () => {
    const sends: SentCall[] = [];
    const { admin } = fakeAdmin({
      sentRows: [{ target_id: "outreach-1", detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "contact@charity.org" } }],
      rpcResults: { capture_gmail_reply: [new Error("boom")] },
    });
    const send = await sendStub(sends);
    const result = await quiet(() => syncGmailReplies({
      admin, config, sender, tokenProvider,
      fetchImpl: fetchStub({ "gmail-1": inboundMessage() }),
      sendNotification: send,
    }));
    assert.deepEqual(result, { scanned: 1, captured: 0, duplicates: 0, ignored: 0, unmatched: 0, failed: 1 });
    assert.deepEqual(sends, []);
  });

  it("skips messages already captured without fetching them again", async () => {
    const fetched: string[] = [];
    const inner = fetchStub({ "gmail-old": inboundMessage({ id: "gmail-old" }), "gmail-1": inboundMessage() });
    const fetchImpl = (async (input: string | URL | Request) => {
      fetched.push(String(input));
      return inner(input);
    }) as typeof fetch;
    const { admin, rpcCalls } = fakeAdmin({
      sentRows: [{ target_id: "outreach-1", detail: { organisation_id: "org-1", provider_thread_id: "thread-1", sent_to: "contact@charity.org" } }],
      rpcResults: { capture_gmail_reply: ["reply-id-1"] },
      capturedIds: ["gmail-old"],
    });
    const result = await syncGmailReplies({ admin, config, sender, tokenProvider, fetchImpl });
    assert.deepEqual(result, { scanned: 2, captured: 1, duplicates: 1, ignored: 0, unmatched: 0, failed: 0 });
    assert.equal(fetched.some((url) => url.includes("/messages/gmail-old")), false);
    assert.equal(rpcCalls.length, 1);
  });

  it("lists only the recent window on a push-triggered run", async () => {
    const listed: string[] = [];
    const inner = fetchStub({});
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes("/messages?")) listed.push(new URL(String(input)).searchParams.get("q") ?? "");
      return inner(input);
    }) as typeof fetch;
    const before = Math.floor((Date.now() - 15 * 60_000) / 1000);
    await syncGmailReplies({ admin: fakeAdmin({}).admin, config, sender, tokenProvider, fetchImpl }, { sinceMinutes: 15 });
    const after = Number(listed[0]?.match(/^in:inbox after:(\d+)$/)?.[1]);
    assert.ok(after >= before && after <= before + 5, `unexpected query ${listed[0]}`);
  });

  it("throws when the reply sync is not configured even with Gmail environment variables set", async () => {
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      GMAIL_CLIENT_ID: "test-client",
      GMAIL_CLIENT_SECRET: "test-secret",
      GMAIL_REFRESH_TOKEN: "test-refresh",
      GMAIL_SENDER_EMAIL: sender,
    };
    const fetchImpl = (async () => {
      assert.fail("Unconfigured reply sync must not make network requests");
    }) as typeof fetch;

    try {
      for (const missing of [{ config: null, sender }, { config, sender: null }]) {
        await assert.rejects(
          () => syncGmailReplies({ admin: fakeAdmin({}).admin, ...missing, tokenProvider, fetchImpl }),
          /not configured/,
        );
      }
    } finally {
      process.env = originalEnv;
    }
  });
});

describe("notifyReplyOwnerByEmail (F179 AC1/AC3)", () => {
  it("sends to the active owner who has the reply type in their preferences", async () => {
    const sends: SentCall[] = [];
    const { admin } = fakeAdmin({
      organisation: { owner_id: "user-1", legal_name: "Charity Ltd" },
      user: { email: "cam@180dc.org", is_active: true, email_notification_types: ["client_reply_received"] },
    });
    await notifyReplyOwnerByEmail(admin, "org-1", "Yes, let's talk.", await sendStub(sends));
    assert.deepEqual(sends, [{ to: "cam@180dc.org", subject: "Charity Ltd replied", text: "Yes, let's talk." }]);
  });

  it("does not email an owner who has explicitly opted out of email", async () => {
    const sends: SentCall[] = [];
    const { admin } = fakeAdmin({
      organisation: { owner_id: "user-1", legal_name: "Charity Ltd" },
      user: { email: "cam@180dc.org", is_active: true, email_notification_types: [] },
    });
    await notifyReplyOwnerByEmail(admin, "org-1", "Yes", await sendStub(sends));
    assert.deepEqual(sends, []);
  });

  it("never emails when the owner is inactive (admins stay in-app only)", async () => {
    const sends: SentCall[] = [];
    const { admin } = fakeAdmin({
      organisation: { owner_id: "user-1", legal_name: "Charity Ltd" },
      user: { email: "cam@180dc.org", is_active: false, email_notification_types: ["client_reply_received"] },
    });
    await notifyReplyOwnerByEmail(admin, "org-1", "Yes", await sendStub(sends));
    assert.deepEqual(sends, []);
  });

  it("does not email a client with no owner", async () => {
    const sends: SentCall[] = [];
    const { admin } = fakeAdmin({ organisation: { owner_id: null, legal_name: "Charity Ltd" } });
    await notifyReplyOwnerByEmail(admin, "org-1", "Yes", await sendStub(sends));
    assert.deepEqual(sends, []);
  });
});
