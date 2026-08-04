import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import {
  DUPLICATE_INVITE_MESSAGE,
  sendInvite,
  type InviteAdminClient,
  type LookupExistingUser,
} from "./invite.ts";

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

type AdminBehaviour = { ok: true } | { error: string } | { throws: Error };

function fakeAdminClient(behaviour: AdminBehaviour): {
  client: InviteAdminClient;
  calls: { email: string; redirectTo?: string; data?: Record<string, unknown> }[];
} {
  const calls: { email: string; redirectTo?: string; data?: Record<string, unknown> }[] = [];

  const client: InviteAdminClient = {
    auth: {
      admin: {
        async inviteUserByEmail(email, options) {
          calls.push({ email, redirectTo: options?.redirectTo, data: options?.data });
          if ("throws" in behaviour) throw behaviour.throws;
          if ("error" in behaviour) return { data: null, error: { message: behaviour.error } };
          return { data: { user: { id: "new-user" } }, error: null };
        },
      },
    },
  };

  return { client, calls };
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

  it("reports a send failure as a generic error, without leaking the cause", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin } = fakeAdminClient({ error: "email quota exceeded" });

    const { result, logs } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org"),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.doesNotMatch(result.state.message ?? "", /quota/);
    }
    assert.ok(logs.some((log) => log.includes("user.invite_failed")));
  });

  it("sends the invite with the inviting admin's id and the redirect URL", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin, calls: adminCalls } = fakeAdminClient({ ok: true });

    const { result, logs } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "Ada@180DC.org" }, REDIRECT_TO, "180dc.org"),
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

  it("never logs the invited email address itself", async () => {
    const { lookup } = fakeLookupClient({ row: null });
    const { client: admin } = fakeAdminClient({ ok: true });

    const { logs } = await silencingLogs(() =>
      sendInvite(lookup, admin, INVITED_BY, { email: "ada@180dc.org" }, REDIRECT_TO, "180dc.org"),
    );

    assert.ok(logs.every((log) => !log.includes("ada@180dc.org")));
  });
});
