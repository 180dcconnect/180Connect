import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveBookletSources, deriveSourcesFromSavedRow } from "./sources.ts";

describe("deriveBookletSources", () => {
  it("full sources: profile plus a used website both contribute", () => {
    const sources = deriveBookletSources({ text: "About us…", hostname: "test-charity.org" });
    assert.deepEqual(sources, [
      { type: "profile", verified: true },
      { type: "website", verified: false, hostname: "test-charity.org" },
    ]);
  });

  it("partial sources: no website context means profile is the only source", () => {
    const sources = deriveBookletSources(null);
    assert.deepEqual(sources, [{ type: "profile", verified: true }]);
  });

  it("an unreachable/skipped website is never listed as if it contributed", () => {
    // scrape-website.ts's contract: an unreachable site resolves to a null
    // websiteContext, exactly like "no URL was given" from this function's view —
    // there is no separate "attempted but failed" source.
    const sources = deriveBookletSources(null);
    assert.equal(sources.some((source) => source.type === "website"), false);
  });
});

describe("deriveSourcesFromSavedRow", () => {
  it("reconstructs a used website source from the saved URL", () => {
    const sources = deriveSourcesFromSavedRow({
      websiteContextUsed: true,
      websiteUrl: "https://test-charity.org/about",
    });
    assert.deepEqual(sources, [
      { type: "profile", verified: true },
      { type: "website", verified: false, hostname: "test-charity.org" },
    ]);
  });

  it("profile-only when the saved row never used a website", () => {
    const sources = deriveSourcesFromSavedRow({ websiteContextUsed: false, websiteUrl: null });
    assert.deepEqual(sources, [{ type: "profile", verified: true }]);
  });

  it("degrades to profile-only rather than throwing on an unparseable stored URL", () => {
    const sources = deriveSourcesFromSavedRow({ websiteContextUsed: true, websiteUrl: "not a url" });
    assert.deepEqual(sources, [{ type: "profile", verified: true }]);
  });
});
