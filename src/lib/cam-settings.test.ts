import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasConfiguredPreferences,
  getGeographicReachLabels,
  getIncomeBandLabels,
  getSanitizedSectors,
  sanitizeQueuePreferences,
  type CamOutreachPreferences,
} from "./cam-settings.ts";
import { authorizeUserProfile, type UserProfile } from "./auth/permissions.ts";
import { adminRouteDestination, ADMIN_ACCESS_DENIED_PATH } from "./auth/admin-route.ts";

describe("cam-settings helpers (F187)", () => {
  describe("access & permission boundaries", () => {
    const adminProfile: UserProfile = {
      id: "u-admin",
      full_name: "Admin User",
      role: "admin",
      is_active: true,
    };
    const camProfile: UserProfile = {
      id: "u-cam",
      full_name: "CAM User",
      role: "cam",
      is_active: true,
    };
    const viewerProfile: UserProfile = {
      id: "u-viewer",
      full_name: "Viewer User",
      role: "viewer",
      is_active: true,
    };
    const inactiveAdminProfile: UserProfile = {
      id: "u-inactive",
      full_name: "Inactive Admin",
      role: "admin",
      is_active: false,
    };

    it("allows active admins to access user:manage permission", () => {
      const auth = authorizeUserProfile({ id: "u-admin" }, adminProfile, "user:manage");
      assert.equal(auth.ok, true);
    });

    it("blocks active CAMs from accessing user:manage permission", () => {
      const auth = authorizeUserProfile({ id: "u-cam" }, camProfile, "user:manage");
      assert.equal(auth.ok, false);
      if (!auth.ok) {
        assert.equal(auth.reason, "forbidden");
        assert.equal(adminRouteDestination(auth.reason), ADMIN_ACCESS_DENIED_PATH);
      }
    });

    it("blocks active viewers from accessing user:manage permission", () => {
      const auth = authorizeUserProfile({ id: "u-viewer" }, viewerProfile, "user:manage");
      assert.equal(auth.ok, false);
      if (!auth.ok) {
        assert.equal(auth.reason, "forbidden");
        assert.equal(adminRouteDestination(auth.reason), ADMIN_ACCESS_DENIED_PATH);
      }
    });

    it("redirects inactive accounts to login", () => {
      const auth = authorizeUserProfile({ id: "u-inactive" }, inactiveAdminProfile, "user:manage");
      assert.equal(auth.ok, false);
      if (!auth.ok) {
        assert.equal(auth.reason, "inactive");
        assert.equal(adminRouteDestination(auth.reason), "/login");
      }
    });

    it("redirects unauthenticated visitors to login", () => {
      const auth = authorizeUserProfile(null, null, "user:manage");
      assert.equal(auth.ok, false);
      if (!auth.ok) {
        assert.equal(auth.reason, "unauthenticated");
        assert.equal(adminRouteDestination(auth.reason), "/login");
      }
    });
  });

  describe("hasConfiguredPreferences", () => {
    it("returns false for null or undefined", () => {
      assert.equal(hasConfiguredPreferences(null), false);
      assert.equal(hasConfiguredPreferences(undefined), false);
    });

    it("returns false when all arrays are empty", () => {
      const emptyPrefs: CamOutreachPreferences = {
        user_id: "u-1",
        preferred_geographic_reach: [],
        preferred_sectors: [],
        preferred_income_bands: [],
      };
      assert.equal(hasConfiguredPreferences(emptyPrefs), false);
    });

    it("returns true when geography is configured", () => {
      const prefs: CamOutreachPreferences = {
        user_id: "u-1",
        preferred_geographic_reach: ["local"],
        preferred_sectors: [],
        preferred_income_bands: [],
      };
      assert.equal(hasConfiguredPreferences(prefs), true);
    });

    it("returns true when sectors are configured", () => {
      const prefs: CamOutreachPreferences = {
        user_id: "u-1",
        preferred_geographic_reach: [],
        preferred_sectors: ["Education"],
        preferred_income_bands: [],
      };
      assert.equal(hasConfiguredPreferences(prefs), true);
    });

    it("returns true when income bands are configured", () => {
      const prefs: CamOutreachPreferences = {
        user_id: "u-1",
        preferred_geographic_reach: [],
        preferred_sectors: [],
        preferred_income_bands: ["100k_1m"],
      };
      assert.equal(hasConfiguredPreferences(prefs), true);
    });
  });

  describe("label formatting", () => {
    it("formats geographic reach labels properly", () => {
      assert.deepEqual(getGeographicReachLabels(["local", "national"]), [
        "Local",
        "National",
      ]);
      assert.deepEqual(getGeographicReachLabels([]), []);
      assert.deepEqual(getGeographicReachLabels(null), []);
    });

    it("formats income band labels properly", () => {
      assert.deepEqual(getIncomeBandLabels(["under_10k", "over_1m"]), [
        "Under £10k",
        "Over £1m",
      ]);
      assert.deepEqual(getIncomeBandLabels([]), []);
      assert.deepEqual(getIncomeBandLabels(null), []);
    });

    it("sanitizes sector tags", () => {
      assert.deepEqual(getSanitizedSectors([" Education ", "Health", ""]), [
        "Education",
        "Health",
      ]);
      assert.deepEqual(getSanitizedSectors([]), []);
      assert.deepEqual(getSanitizedSectors(null), []);
    });
  });

  describe("privacy guard (AC2) - sanitizeQueuePreferences", () => {
    it("returns null when user_id is missing or raw input is null", () => {
      assert.equal(sanitizeQueuePreferences(null), null);
      assert.equal(sanitizeQueuePreferences(undefined), null);
      assert.equal(sanitizeQueuePreferences({ preferred_sectors: ["Health"] }), null);
    });

    it("strips out unexpected fields and retains only queue settings", () => {
      const raw = {
        user_id: "u-123",
        preferred_geographic_reach: ["regional" as const],
        preferred_sectors: ["Environment"],
        preferred_income_bands: ["10k_100k" as const],
        updated_at: "2026-08-19T00:00:00Z",
        created_at: "2026-08-19T00:00:00Z",
        // Extra private fields that should NOT be passed through
        password_hash: "secret",
        personal_phone: "123456789",
      };

      const sanitized = sanitizeQueuePreferences(raw);
      assert.deepEqual(sanitized, {
        user_id: "u-123",
        preferred_geographic_reach: ["regional"],
        preferred_sectors: ["Environment"],
        preferred_income_bands: ["10k_100k"],
        updated_at: "2026-08-19T00:00:00Z",
        created_at: "2026-08-19T00:00:00Z",
      });
      assert.equal("password_hash" in (sanitized as object), false);
      assert.equal("personal_phone" in (sanitized as object), false);
    });
  });
});
