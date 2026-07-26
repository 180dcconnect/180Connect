import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "@supabase/supabase-js";
import {
  authorizeUserProfile,
  canChangeRole,
  hasPermission,
} from "./permissions.ts";

function approvedUser(): User {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    email: "admin@180dc.org",
    app_metadata: { account_status: "approved" },
  } as unknown as User;
}

describe("role permission matrix", () => {
  it("allows admins to perform every CAM action", () => {
    for (const permission of ["client:view", "client:edit", "client:contact"] as const) {
      assert.equal(hasPermission("cam", permission), true);
      assert.equal(hasPermission("admin", permission), true);
    }
  });

  it("reserves privileged actions for admins", () => {
    for (const permission of [
      "user:manage",
      "ownership:reassign",
      "approval:manage",
      "platform-settings:manage",
    ] as const) {
      assert.equal(hasPermission("cam", permission), false);
      assert.equal(hasPermission("viewer", permission), false);
      assert.equal(hasPermission("admin", permission), true);
    }
  });

  it("keeps viewers read-only", () => {
    assert.equal(hasPermission("viewer", "client:view"), true);
    assert.equal(hasPermission("viewer", "client:edit"), false);
    assert.equal(hasPermission("viewer", "client:contact"), false);
  });
});

describe("role-change safety", () => {
  it("blocks an administrator changing their own role", () => {
    assert.equal(canChangeRole("admin-id", "admin-id").ok, false);
  });

  it("allows an administrator to target another user", () => {
    assert.deepEqual(canChangeRole("admin-id", "cam-id"), { ok: true });
  });
});

describe("request-time actor authorization", () => {
  it("allows an active admin", () => {
    const result = authorizeUserProfile(
      approvedUser(),
      {
        id: approvedUser().id,
        full_name: "Admin",
        role: "admin",
        is_active: true,
      },
      "user:manage",
    );
    assert.equal(result.ok, true);
  });

  it("rejects a direct CAM request for an admin permission", () => {
    const result = authorizeUserProfile(
      approvedUser(),
      {
        id: approvedUser().id,
        full_name: "CAM",
        role: "cam",
        is_active: true,
      },
      "user:manage",
    );
    assert.deepEqual(result, { ok: false, reason: "forbidden" });
  });

  it("rejects unauthenticated and inactive users", () => {
    assert.deepEqual(authorizeUserProfile(null, null), {
      ok: false,
      reason: "unauthenticated",
    });
    assert.deepEqual(
      authorizeUserProfile(approvedUser(), {
        id: approvedUser().id,
        full_name: "Former CAM",
        role: "cam",
        is_active: false,
      }),
      { ok: false, reason: "inactive" },
    );
  });

  it("uses the supplied current profile on every request", () => {
    const user = approvedUser();
    const cam = authorizeUserProfile(
      user,
      { id: user.id, full_name: "User", role: "cam", is_active: true },
      "user:manage",
    );
    const promoted = authorizeUserProfile(
      user,
      { id: user.id, full_name: "User", role: "admin", is_active: true },
      "user:manage",
    );
    assert.equal(cam.ok, false);
    assert.equal(promoted.ok, true);
  });
});
