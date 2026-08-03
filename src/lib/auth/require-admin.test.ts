import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { adminPermissionFailureMessage, requireAdmin } from "./require-admin.ts";

function makeUser(accountStatus: string | undefined): User {
  return { id: "u1", app_metadata: { account_status: accountStatus } } as unknown as User;
}

// Fakes only the chain requireAdmin actually calls:
// supabase.from("users").select("role").eq("id", user.id).single()
function makeSupabase(role: string | null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: role === null ? null : { role } }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("requireAdmin", () => {
  it("rejects a null user as unauthenticated, without querying the database", async () => {
    assert.deepEqual(await requireAdmin(makeSupabase("admin"), null), {
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("rejects an unapproved user before checking role", async () => {
    assert.deepEqual(await requireAdmin(makeSupabase("admin"), makeUser("pending")), {
      ok: false,
      reason: "not_approved",
    });
  });

  it("rejects an approved user whose role is not admin", async () => {
    assert.deepEqual(await requireAdmin(makeSupabase("cam"), makeUser("approved")), {
      ok: false,
      reason: "not_admin",
    });
  });

  it("rejects an approved user with no matching users row", async () => {
    assert.deepEqual(await requireAdmin(makeSupabase(null), makeUser("approved")), {
      ok: false,
      reason: "not_admin",
    });
  });

  it("allows an approved admin", async () => {
    assert.deepEqual(await requireAdmin(makeSupabase("admin"), makeUser("approved")), {
      ok: true,
    });
  });
});

describe("adminPermissionFailureMessage", () => {
  it("gives a distinct message for not_admin", () => {
    assert.notEqual(
      adminPermissionFailureMessage("not_admin"),
      adminPermissionFailureMessage("unauthenticated"),
    );
  });

  it("delegates the shared reasons to permissionFailureMessage", () => {
    assert.doesNotMatch(adminPermissionFailureMessage("not_admin"), /exist|found/i);
    assert.doesNotMatch(adminPermissionFailureMessage("unauthenticated"), /exist|found/i);
  });
});
