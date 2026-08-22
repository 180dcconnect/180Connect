import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { ROLES } from "./auth/permissions.ts";
import { NAV_ITEMS, navItemsFor } from "./nav.ts";

describe("navigation", () => {
  it("only links to routes that exist", async () => {
    for (const item of NAV_ITEMS) {
      const dir = `src/app${item.href}`;
      const entries = await readdir(dir).catch(() => null);
      assert.ok(entries, `${item.href} has no directory at ${dir}`);
      assert.ok(
        entries.includes("page.tsx"),
        `${item.href} has no page.tsx — do not link to it yet`,
      );
    }
  });

  it("gives admins the admin workspace", () => {
    const hrefs = navItemsFor("admin").map((item) => item.href);
    assert.ok(hrefs.includes("/admin"));
  });

  it("hides admin-only destinations from other roles", () => {
    for (const role of ROLES.filter((candidate) => candidate !== "admin")) {
      const hrefs = navItemsFor(role).map((item) => item.href);
      assert.ok(!hrefs.includes("/admin/users"));
    }
  });

  it("gives every role their own profile", () => {
    for (const role of ROLES) {
      const hrefs = navItemsFor(role).map((item) => item.href);
      assert.ok(hrefs.includes("/settings/profile"));
    }
  });

  it("gives every role accessibility settings (F205)", () => {
    for (const role of ROLES) {
      const hrefs = navItemsFor(role).map((item) => item.href);
      assert.ok(hrefs.includes("/settings/accessibility"));
    }
  });
});
