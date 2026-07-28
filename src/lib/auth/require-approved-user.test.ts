import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "@supabase/supabase-js";

import { permissionFailureMessage, requireApprovedUser } from "./require-approved-user.ts";

function makeUser(accountStatus: string | undefined): User {
  return { app_metadata: { account_status: accountStatus } } as unknown as User;
}

describe("requireApprovedUser", () => {
  it("rejects a null user as unauthenticated", () => {
    assert.deepEqual(requireApprovedUser(null), {
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("rejects a user whose account is not approved", () => {
    assert.deepEqual(requireApprovedUser(makeUser("pending")), {
      ok: false,
      reason: "not_approved",
    });
  });

  it("rejects a user with no account_status set", () => {
    assert.deepEqual(requireApprovedUser(makeUser(undefined)), {
      ok: false,
      reason: "not_approved",
    });
  });

  it("allows an approved user", () => {
    assert.deepEqual(requireApprovedUser(makeUser("approved")), { ok: true });
  });
});

describe("permissionFailureMessage", () => {
  it("gives a distinct message per reason", () => {
    assert.notEqual(
      permissionFailureMessage("unauthenticated"),
      permissionFailureMessage("not_approved"),
    );
  });

  it("does not reveal whether a resource exists", () => {
    assert.doesNotMatch(permissionFailureMessage("not_approved"), /exist|found/i);
    assert.doesNotMatch(permissionFailureMessage("unauthenticated"), /exist|found/i);
  });
});
