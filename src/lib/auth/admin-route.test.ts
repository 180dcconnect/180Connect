import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADMIN_ACCESS_DENIED_PATH, adminRouteDestination } from "./admin-route.ts";
import {
  authorizeUserProfile,
  type PermissionFailureReason,
} from "./permissions.ts";
import type { User } from "@supabase/supabase-js";

function approvedUser(): User {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    email: "cam@180dc.org",
    app_metadata: { account_status: "approved" },
  } as unknown as User;
}

// Every reason getCurrentActor can return. Listed here rather than derived so
// that adding a reason to PermissionFailureReason without deciding where it
// sends a refused request fails to compile.
const ALL_REASONS: Record<PermissionFailureReason, true> = {
  unauthenticated: true,
  not_approved: true,
  inactive: true,
  profile_missing: true,
  forbidden: true,
};

describe("admin route boundary (F017 AC2)", () => {
  it("sends a signed-in CAM who typed an admin URL to the dashboard, with a reason", () => {
    // The full path a direct-URL request takes: the CAM's profile is authorized
    // against the permission every admin route gates on, and the refusal it
    // produces decides the redirect. This is the boundary, end to end.
    const refusal = authorizeUserProfile(
      approvedUser(),
      { id: approvedUser().id, full_name: "CAM", role: "cam", is_active: true },
      "user:manage",
    );

    assert.equal(refusal.ok, false, "a CAM must not hold user:manage");
    assert.equal(
      adminRouteDestination(refusal.ok ? "forbidden" : refusal.reason),
      ADMIN_ACCESS_DENIED_PATH,
    );
    assert.match(
      ADMIN_ACCESS_DENIED_PATH,
      /^\/dashboard\?error=/,
      "the dashboard needs the error param to explain the refusal",
    );
  });

  it("sends a viewer the same way — no role but admin reaches an admin route", () => {
    const refusal = authorizeUserProfile(
      approvedUser(),
      { id: approvedUser().id, full_name: "Viewer", role: "viewer", is_active: true },
      "user:manage",
    );
    assert.deepEqual(refusal, { ok: false, reason: "forbidden" });
    assert.equal(adminRouteDestination("forbidden"), ADMIN_ACCESS_DENIED_PATH);
  });

  it("sends an unusable session to the login page, not through the dashboard", () => {
    // /dashboard refuses all four of these itself, so routing them there would
    // only add a redirect the user never sees.
    for (const reason of [
      "unauthenticated",
      "not_approved",
      "inactive",
      "profile_missing",
    ] as const) {
      assert.equal(adminRouteDestination(reason), "/login", reason);
    }
  });

  it("decides a destination for every failure reason that exists", () => {
    for (const reason of Object.keys(ALL_REASONS) as PermissionFailureReason[]) {
      const destination = adminRouteDestination(reason);
      assert.ok(
        destination === "/login" || destination === ADMIN_ACCESS_DENIED_PATH,
        `${reason} has no destination`,
      );
    }
  });
});
