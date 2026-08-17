import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPathAllowedByRobots } from "./robots.ts";

describe("isPathAllowedByRobots", () => {
  it("allows everything when the file says nothing about us", () => {
    assert.equal(isPathAllowedByRobots("", "/about"), true);
    assert.equal(isPathAllowedByRobots("Sitemap: https://x.org/sitemap.xml", "/about"), true);
  });

  it("honours a wildcard group", () => {
    const robots = "User-agent: *\nDisallow: /private\n";
    assert.equal(isPathAllowedByRobots(robots, "/private/notes"), false);
    assert.equal(isPathAllowedByRobots(robots, "/about"), true);
  });

  it("prefers a group naming us over the wildcard group", () => {
    const robots = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: 180Connect-Import",
      "Disallow: /admin",
    ].join("\n");

    assert.equal(isPathAllowedByRobots(robots, "/about"), true);
    assert.equal(isPathAllowedByRobots(robots, "/admin/login"), false);
  });

  it("lets a longer Allow carve an exception out of a broad Disallow", () => {
    const robots = "User-agent: *\nDisallow: /\nAllow: /about\n";
    assert.equal(isPathAllowedByRobots(robots, "/about"), true);
    assert.equal(isPathAllowedByRobots(robots, "/donate"), false);
  });

  it("treats an empty Disallow as permission, not prohibition", () => {
    assert.equal(isPathAllowedByRobots("User-agent: *\nDisallow:\n", "/anything"), true);
  });

  it("applies one rule block shared by consecutive user-agent lines", () => {
    const robots = "User-agent: BadBot\nUser-agent: 180Connect-Import\nDisallow: /search\n";
    assert.equal(isPathAllowedByRobots(robots, "/search?q=1"), false);
    assert.equal(isPathAllowedByRobots(robots, "/about"), true);
  });

  it("understands * inside a pattern and $ at the end", () => {
    const robots = "User-agent: *\nDisallow: /*.pdf$\n";
    assert.equal(isPathAllowedByRobots(robots, "/reports/annual.pdf"), false);
    assert.equal(isPathAllowedByRobots(robots, "/reports/annual.pdf.html"), true);
  });

  it("ignores comments and unknown directives", () => {
    const robots = "# our rules\nUser-agent: *\nCrawl-delay: 10\nDisallow: /private # secret\n";
    assert.equal(isPathAllowedByRobots(robots, "/private"), false);
    assert.equal(isPathAllowedByRobots(robots, "/public"), true);
  });
});
