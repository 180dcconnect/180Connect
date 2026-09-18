import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { ROLES } from "./auth/permissions.ts";
import { NAV_ITEMS, navItemsFor } from "./nav.ts";

describe("navigation", () => {
  it("only links to routes that exist", async () => {
    // A route may sit inside a route group — `src/app/(app)/clients` serves
    // `/clients` — so every `(group)` folder is a place the route can live.
    const groups = (await readdir("src/app")).filter((name) => /^\(.+\)$/.test(name));
    for (const item of NAV_ITEMS) {
      const candidates = [
        `src/app${item.href}`,
        ...groups.map((group) => `src/app/${group}${item.href}`),
      ];
      let dir = candidates[0];
      let entries: string[] | null = null;
      for (const candidate of candidates) {
        entries = await readdir(candidate).catch(() => null);
        if (entries) {
          dir = candidate;
          break;
        }
      }
      assert.ok(entries, `${item.href} has no directory at ${candidates.join(" or ")}`);
      assert.ok(dir);
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
