import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import {
  DUPLICATE_INVITE_MESSAGE,
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_EXPIRY_HOURS,
  INVITE_NOT_FOUND_MESSAGE,
  escapeHtml,
  inviteEmail,
  resendInvite,
  sendInvite,
  type InviteAdminClient,
  type InviteSender,
  type LookupExistingUser,
  type LookupPendingInvite,
} from "./invite.ts";

const RESEND_USER_ID = "user-42";

type PendingLookupBehaviour =
  | { row: { email: string; accepted: boolean } | null }
  | { error: string };

function fakePendingLookup(behaviour: PendingLookupBehaviour): {
  lookup: LookupPendingInvite;
  calls: string[];
} {
  const calls: string[] = [];

  const lookup: LookupPendingInvite = async (userId: string) => {
    calls.push(userId);
    if ("error" in behaviour) throw new Error(behaviour.error);
    return behaviour.row;
  };

  return { lookup, calls };
}

const REDIRECT_TO = "https://180connect.vercel.app/auth/confirm";
const INVITED_BY = "admin-1";

type LookupBehaviour = { row: { id: string } | null } | { error: string };

function fakeLookupClient(behaviour: LookupBehaviour): {
  lookup: LookupExistingUser;
  calls: string[];
} {
  const calls: string[] = [];

  const lookup: LookupExistingUser = async (email: string) => {
    calls.push(email);
    if ("error" in behaviour) throw new Error(behaviour.error);
    return behaviour.row;
  };

  return { lookup, calls };
}

type AdminBehaviour =
  | { ok: true }
  | { error: string }
  | { throws: Error }
  /** Supabase answered without the token the link cannot be built without. */
  | { noToken: true };

// Deliberately unlike a real token: plain words, no prefix, low entropy.
//
// The first version of this fixture imitated a real Supabase token — a short
// prefix and a random-looking tail — and the secret scanner flagged it on
// PR #305. A false positive, but a fair one, since that is exactly the shape it
// looks for. Allow-listing the scanner would have been the wrong fix for a value
// we control; making the fixture obviously fake is the right one. Keep it that
// way, and do not paste a realistic-looking token in here.
const TOKEN_HASH = "fake-token-hash-for-tests";

function fakeAdminClient(behaviour: AdminBehaviour): {
  client: InviteAdminClient;
  calls: { email: string; redirectTo?: string; data?: Record<string, unknown> }[];
} {
  const calls: { email: string; redirectTo?: string; data?: Record<string, unknown> }[] = [];

  const client: InviteAdminClient = {
    auth: {
      admin: {
        async generateLink({ email, options }) {
          calls.push({ email, redirectTo: options?.redirectTo, data: options?.data });
          if ("throws" in behaviour) throw behaviour.throws;
          if ("error" in behaviour) return { data: null, error: { message: behaviour.error } };
          if ("noToken" in behaviour) {
            return { data: { properties: null, user: { id: "new-user" } }, error: null };
          }
          return {
            data: {
              properties: { hashed_token: TOKEN_HASH },
              user: { id: "new-user" },
            },
            error: null,
          };
        },
      },
    },
  };

  return { client, calls };
}

type SendBehaviour =
  | { status: "sent" }
  | { status: "skipped" | "failed"; reason: string };

/**
 * Always injected, never defaulted: without it the real `sendEmail` runs, and
 * the console transport would print an invite body into the test output.
 */
function fakeSender(behaviour: SendBehaviour = { status: "sent" }): {
  send: InviteSender;
  sent: { to: string; subject: string; text: string; html: string }[];
} {
  const sent: { to: string; subject: string; text: string; html: string }[] = [];

  const send: InviteSender = async (message) => {
    sent.push(message);
    return behaviour.status === "sent"
      ? { status: "sent" }
      : { status: behaviour.status, reason: behaviour.reason };
  };

  return { send, sent };
}

/** Runs `fn` with `logSecurityEvent`'s console.error captured, same as login.test.ts. */
async function silencingLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const errorMock = mock.method(console, "error", () => {});
  try {
    const result = await fn();
    return {
      result,
      logs: errorMock.mock.calls.map((call) => JSON.stringify(call.arguments)),
    };
  } finally {
    errorMock.mock.restore();
  }
}

describe("sendInvite", () => {
  it("rejects a malformed email without calling the lookup or the admin API", async () => {
    const { lookup, calls: lookupCalls } = fakeLookupClient({ row: null });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });

    const { result } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "not-an-email" }, REDIRECT_TO),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.state.fieldErrors?.email?.length);
    }
    assert.equal(lookupCalls.length, 0);
    assert.equal(adminCalls.length, 0);
  });

  it("rejects an email outside the allowed domain", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });

    const { result } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "person@gmail.com" }, REDIRECT_TO, "180dc.org"),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.state.fieldErrors?.email?.[0] ?? "", /180dc\.org/);
    }
    assert.equal(adminCalls.length, 0);
  });

  it("blocks an email that already has a row, without sending an invite", async () => {
    const { lookup } = fakeLookupClient({ row: { id: "existing-user" } });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });

    const { result, logs } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org"),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.state.message, DUPLICATE_INVITE_MESSAGE);
    }
    assert.equal(adminCalls.length, 0);
    assert.ok(logs.some((log) => log.includes("user.invite_rejected")));
  });

  it("reports a lookup failure as a generic error, without sending an invite", async () => {
    const { lookup } = fakeLookupClient({ error: "connection reset" });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });

    const { result, logs } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org"),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.doesNotMatch(result.state.message ?? "", /connection reset/);
    }
    assert.equal(adminCalls.length, 0);
    assert.ok(logs.some((log) => log.includes("user.invite_failed")));
  });

  it("reports a token-minting failure as a generic error, without leaking the cause", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin } = fakeAdminClient({ error: "email quota exceeded" });
    const { send, sent } = fakeSender();

    const { result, logs } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org", {
        send,
      }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.doesNotMatch(result.state.message ?? "", /quota/);
    }
    assert.equal(sent.length, 0, "nothing to email when there is no token");
    assert.ok(logs.some((log) => log.includes("user.invite_failed")));
  });

  it("fails rather than emailing a link it could not build", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin } = fakeAdminClient({ noToken: true });
    const { send, sent } = fakeSender();

    const { result } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org", {
        send,
      }),
    );

    assert.equal(result.ok, false);
    assert.equal(sent.length, 0);
  });

  it("sends the invite with the inviting admin's id and the redirect URL", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });
    const { send } = fakeSender();

    const { result, logs } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "Ada@180DC.org" }, REDIRECT_TO, "180dc.org", {
        send,
      }),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.state.message ?? "", /ada@180dc\.org/);
    }
    assert.equal(adminCalls.length, 1);
    assert.equal(adminCalls[0].email, "ada@180dc.org");
    assert.equal(adminCalls[0].redirectTo, REDIRECT_TO);
    assert.deepEqual(adminCalls[0].data, { invited_by_user_id: INVITED_BY });
    assert.ok(logs.some((log) => log.includes("user.invited")));
  });

  it("emails a token_hash link on the configured redirect, not Supabase's action link", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin } = fakeAdminClient({ ok: true });
    const { send, sent } = fakeSender();

    await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org", {
        send,
        inviterName: "Bashir",
      }),
    );

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "ada@180dc.org");
    const expected = `${REDIRECT_TO}?token_hash=${TOKEN_HASH}&type=invite`;
    assert.ok(sent[0].text.includes(expected), "the plain-text body carries the full link");
    // The HTML body carries the same URL with the query separator escaped, which is
    // what belongs inside an href — a browser reads `&amp;` back as `&`.
    assert.ok(sent[0].html.includes(expected.replace(/&/g, "&amp;")));
    assert.match(sent[0].text, /Bashir/);
  });

  it("reports an undelivered invite as a warning, not a success or an error", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin } = fakeAdminClient({ ok: true });
    const { send } = fakeSender({ status: "failed", reason: "Domain is not verified." });

    const { result } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org", {
        send,
      }),
    );

    // ok stays true: the account exists, so the pending invite must still show up.
    assert.equal(result.ok, true);
    assert.equal(result.state.status, "warning");
    assert.match(result.state.message ?? "", /not sent/);
  });

  it("treats the console transport's skip as undelivered too", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin } = fakeAdminClient({ ok: true });
    const { send } = fakeSender({ status: "skipped", reason: "No RESEND_API_KEY set." });

    const { result } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org", {
        send,
      }),
    );

    assert.equal(result.state.status, "warning");
  });

  it("never logs the invited email address itself", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin } = fakeAdminClient({ ok: true });
    const { send } = fakeSender();

    const { logs } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org", {
        send,
      }),
    );

    assert.ok(logs.every((log) => !log.includes("ada@180dc.org")));
  });
});

describe("inviteEmail", () => {
  const link = "https://180connect.vercel.app/auth/confirm?token_hash=abc&type=invite";

  it("puts the link in the plain-text body, not only behind a button", () => {
    assert.ok(inviteEmail({ link, inviterName: "Bashir" }).text.includes(link));
  });

  it("names the inviter and the expiry", () => {
    const { text } = inviteEmail({ link, inviterName: "Bashir" });
    assert.match(text, /Bashir/);
    assert.match(text, new RegExp(`${INVITE_EXPIRY_HOURS} hours`));
  });

  it("escapes a name that would otherwise inject markup into the HTML body", () => {
    const { html } = inviteEmail({ link, inviterName: '<script>alert("x")</script>' });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });

  it("escapes the link so a crafted redirect cannot break out of the href", () => {
    const { html } = inviteEmail({
      link: 'https://example.com/"><img src=x onerror=alert(1)>',
      inviterName: "Bashir",
    });
    assert.doesNotMatch(html, /<img/);
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that matter in an attribute or a body", () => {
    assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("resendInvite", () => {
  it("refuses when no row exists for the id, without calling the admin API", async () => {
    const { lookup } = fakePendingLookup({ row: null });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });
    const { send } = fakeSender();

    const { result, logs } = await silencingLogs(() =>
      resendInvite(lookup, admin, INVITED_BY, RESEND_USER_ID, REDIRECT_TO, { send }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.state.message, INVITE_NOT_FOUND_MESSAGE);
    }
    assert.equal(adminCalls.length, 0);
    assert.ok(logs.some((log) => log.includes("not_found")));
  });

  it("refuses to resend an invite that has already been accepted (AC4)", async () => {
    const { lookup } = fakePendingLookup({
      row: { email: "ada@180dc.org", accepted: true },
    });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });
    const { send } = fakeSender();

    const { result, logs } = await silencingLogs(() =>
      resendInvite(lookup, admin, INVITED_BY, RESEND_USER_ID, REDIRECT_TO, { send }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.state.message, INVITE_ALREADY_ACCEPTED_MESSAGE);
    }
    assert.equal(adminCalls.length, 0, "an accepted invite must never mint a new token");
    assert.ok(logs.some((log) => log.includes("already_accepted")));
  });

  it("reports a lookup failure as a generic error, without calling the admin API", async () => {
    const { lookup } = fakePendingLookup({ error: "connection reset" });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });
    const { send } = fakeSender();

    const { result } = await silencingLogs(() =>
      resendInvite(lookup, admin, INVITED_BY, RESEND_USER_ID, REDIRECT_TO, { send }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.doesNotMatch(result.state.message ?? "", /connection reset/);
    }
    assert.equal(adminCalls.length, 0);
  });

  it("mints a fresh token for the looked-up email and emails it (AC2, AC3)", async () => {
    const { lookup, calls: lookupCalls } = fakePendingLookup({
      row: { email: "ada@180dc.org", accepted: false },
    });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });
    const { send, sent } = fakeSender();

    const { result, logs } = await silencingLogs(() =>
      resendInvite(lookup, admin, INVITED_BY, RESEND_USER_ID, REDIRECT_TO, { send }),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.state.message ?? "", /ada@180dc\.org/);
    }
    assert.deepEqual(lookupCalls, [RESEND_USER_ID], "looks up by id, not a client-supplied email");
    assert.equal(adminCalls.length, 1);
    assert.equal(adminCalls[0].email, "ada@180dc.org");
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, new RegExp(`token_hash=${TOKEN_HASH}`));
    assert.ok(logs.some((log) => log.includes("user.invite_resent")));
  });

  it("reports a mint failure without leaking the cause", async () => {
    const { lookup } = fakePendingLookup({
      row: { email: "ada@180dc.org", accepted: false },
    });
    const { client: admin } = fakeAdminClient({ error: "quota exceeded" });
    const { send } = fakeSender();

    const { result, logs } = await silencingLogs(() =>
      resendInvite(lookup, admin, INVITED_BY, RESEND_USER_ID, REDIRECT_TO, { send }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.doesNotMatch(result.state.message ?? "", /quota/);
    }
    assert.ok(logs.some((log) => log.includes("user.invite_failed")));
  });

  it("reports an undelivered resend as a warning, the same as a first send", async () => {
    const { lookup } = fakePendingLookup({
      row: { email: "ada@180dc.org", accepted: false },
    });
    const { client: admin } = fakeAdminClient({ ok: true });
    const { send } = fakeSender({ status: "failed", reason: "smtp rejected" });

    const { result } = await silencingLogs(() =>
      resendInvite(lookup, admin, INVITED_BY, RESEND_USER_ID, REDIRECT_TO, { send }),
    );

    assert.equal(result.ok, true, "the token was still minted, so this is not an error");
    if (result.ok) {
      assert.equal(result.state.status, "warning");
    }
  });
});
