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
  const reasons = ["unauthenticated", "not_approved", "read_only"] as const;

  it("gives a distinct message per reason", () => {
    const messages = reasons.map(permissionFailureMessage);
    assert.equal(new Set(messages).size, reasons.length);
  });

  it("does not reveal whether a resource exists", () => {
    for (const reason of reasons) {
      assert.doesNotMatch(permissionFailureMessage(reason), /exist|found/i);
    }
  });

  it("tells a read-only user what would fix it (F258 AC4)", () => {
    assert.match(permissionFailureMessage("read_only"), /read-only/i);
    assert.match(permissionFailureMessage("read_only"), /administrator/i);
  });
});
