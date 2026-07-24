import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  USER_ROLES,
  canWrite,
  fetchUserRole,
  isAdmin,
  isCam,
  isUserRole,
  isViewer,
  requireWriteAccess,
} from "./roles.ts";

/**
 * Minimal stand-in for the `.from().select().eq().maybeSingle()` chain. Each method
 * returns the same object, so the chain resolves regardless of call order, and the
 * final `maybeSingle` yields whatever the test supplied.
 */
function makeSupabase(result: { data: unknown; error: unknown }): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("isUserRole", () => {
  it("accepts every role in the enum", () => {
    for (const role of USER_ROLES) {
      assert.equal(isUserRole(role), true, role);
    }
  });

  it("rejects anything else", () => {
    for (const value of ["superadmin", "Admin", "", null, undefined, 3, {}]) {
      assert.equal(isUserRole(value), false, String(value));
    }
  });
});

describe("role predicates", () => {
  it("identify exactly one role each", () => {
    assert.deepEqual(USER_ROLES.filter(isAdmin), ["admin"]);
    assert.deepEqual(USER_ROLES.filter(isCam), ["cam"]);
    assert.deepEqual(USER_ROLES.filter(isViewer), ["viewer"]);
  });

  it("treat a null role as no role", () => {
    assert.equal(isAdmin(null), false);
    assert.equal(isCam(null), false);
    assert.equal(isViewer(null), false);
  });
});

describe("canWrite", () => {
  it("allows admin and CAM", () => {
    assert.equal(canWrite("admin"), true);
    assert.equal(canWrite("cam"), true);
  });

  it("denies viewer — the point of F258", () => {
    assert.equal(canWrite("viewer"), false);
  });

  it("denies an unknown role rather than defaulting to write access", () => {
    // An allow-list, not `role !== "viewer"`. If the enum gains a role and nobody
    // updates this function, the new role is read-only until someone decides.
    assert.equal(canWrite("auditor" as never), false);
    assert.equal(canWrite(null), false);
  });
});

describe("requireWriteAccess", () => {
  it("passes a CAM and an admin", () => {
    assert.deepEqual(requireWriteAccess("cam"), { ok: true });
    assert.deepEqual(requireWriteAccess("admin"), { ok: true });
  });

  it("refuses a viewer as read-only, not as unauthenticated", () => {
    assert.deepEqual(requireWriteAccess("viewer"), { ok: false, reason: "read_only" });
  });

  it("refuses an unknown role as unauthenticated", () => {
    // We do not know the user is a viewer, so we must not tell them they are one.
    assert.deepEqual(requireWriteAccess(null), { ok: false, reason: "unauthenticated" });
  });
});

describe("fetchUserRole", () => {
  it("returns the role when the row is readable", async () => {
    const supabase = makeSupabase({ data: { role: "viewer" }, error: null });
    assert.equal(await fetchUserRole(supabase, "user-1"), "viewer");
  });

  it("returns null when the row is invisible — a deactivated user reads nothing", async () => {
    const supabase = makeSupabase({ data: null, error: null });
    assert.equal(await fetchUserRole(supabase, "user-1"), null);
  });

  it("returns null on a query error rather than failing open", async () => {
    const supabase = makeSupabase({ data: null, error: { message: "boom" } });
    assert.equal(await fetchUserRole(supabase, "user-1"), null);
  });

  it("returns null for a role the app does not recognise", async () => {
    const supabase = makeSupabase({ data: { role: "superadmin" }, error: null });
    assert.equal(await fetchUserRole(supabase, "user-1"), null);
  });
});
