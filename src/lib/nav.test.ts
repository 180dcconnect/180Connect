import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { ROLES } from "./auth/permissions.ts";
import { SIDEBAR_SECTIONS, sidebarSectionsFor } from "./nav.ts";

const allItems = SIDEBAR_SECTIONS.flatMap((section) => section.items);
const UNFINISHED_WORK_DIR = "docs/unfinished-work";

describe("sidebar navigation", () => {
  it("only links to routes that exist, unless marked planned", async () => {
    for (const item of allItems.filter((entry) => !entry.plannedFeatureId)) {
      const dir = `src/app${item.href}`;
      const entries = await readdir(dir).catch(() => null);
      assert.ok(entries, `${item.href} has no directory at ${dir}`);
      assert.ok(
        entries.includes("page.tsx"),
        `${item.href} has no page.tsx — mark it plannedFeatureId or build it`,
      );
    }
  });

  it("every planned entry has a matching unfinished-work doc, and vice versa", async () => {
    const plannedItems = allItems.filter((entry) => entry.plannedFeatureId);
    const slugOf = (href: string) => href.split("/").filter(Boolean).pop();

    for (const item of plannedItems) {
      const slug = slugOf(item.href);
      const path = `${UNFINISHED_WORK_DIR}/${slug}.md`;
      const stat = await readdir(UNFINISHED_WORK_DIR).catch(() => null);
      assert.ok(
        stat?.includes(`${slug}.md`),
        `${item.href} is marked planned but ${path} is missing`,
      );
    }

    const docs = (await readdir(UNFINISHED_WORK_DIR)).filter(
      (name) => name.endsWith(".md") && name !== "README.md",
    );
    const plannedSlugs = new Set(plannedItems.map((item) => slugOf(item.href)));
    for (const doc of docs) {
      const slug = doc.replace(/\.md$/, "");
      assert.ok(
        plannedSlugs.has(slug),
        `${UNFINISHED_WORK_DIR}/${doc} has no matching plannedFeatureId entry in nav.ts — delete the doc or add the entry`,
      );
    }
  });

  it("gives admins the admin workspace", () => {
    const hrefs = sidebarSectionsFor("admin").flatMap((section) => section.items.map((item) => item.href));
    assert.ok(hrefs.includes("/admin"));
  });

  it("hides admin-only destinations from other roles", () => {
    for (const role of ROLES.filter((candidate) => candidate !== "admin")) {
      const hrefs = sidebarSectionsFor(role).flatMap((section) => section.items.map((item) => item.href));
      assert.ok(!hrefs.includes("/admin/users"));
    }
  });

  it("gives every role Dashboard", () => {
    for (const role of ROLES) {
      const hrefs = sidebarSectionsFor(role).flatMap((section) => section.items.map((item) => item.href));
      assert.ok(hrefs.includes("/dashboard"));
    }
  });
});
