import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildBookletPrompt } from "./build-prompt.ts";

const RICH_ORG = {
  legal_name: "Test Charity",
  organisation_type: "charity",
  website: "https://test-charity.org",
  city: "London",
  country_code: "GB",
};

const RICH_ENRICHMENT = {
  mission_statement: "Supporting young people into employment.",
  mission_keywords: ["youth", "employment", "training"],
  sector: "Education",
  sub_sector: "Youth services",
};

describe("buildBookletPrompt", () => {
  it("includes every provided field in the user prompt", () => {
    const { prompt } = buildBookletPrompt(RICH_ORG, RICH_ENRICHMENT);
    assert.match(prompt, /Test Charity/);
    assert.match(prompt, /charity/);
    assert.match(prompt, /London/);
    assert.match(prompt, /https:\/\/test-charity\.org/);
    assert.match(prompt, /Supporting young people into employment\./);
    assert.match(prompt, /youth, employment, training/);
    assert.match(prompt, /Education/);
    assert.match(prompt, /Youth services/);
  });

  it("marks missing fields as Not provided rather than omitting them", () => {
    const { prompt } = buildBookletPrompt(
      { legal_name: "Sparse Charity", organisation_type: "charity", website: null, city: null, country_code: "GB" },
      null,
    );
    assert.match(prompt, /Sparse Charity/);
    // City missing falls back to country_code via formatLocation, not "Not provided".
    assert.match(prompt, /Location: GB/);
    assert.match(prompt, /Website: Not provided/);
    assert.match(prompt, /Mission: Not provided/);
    assert.match(prompt, /Mission keywords: Not provided/);
    assert.match(prompt, /Sector: Not provided/);
    assert.match(prompt, /Sub-sector: Not provided/);
  });

  it("instructs the model not to fabricate details missing from the profile", () => {
    const { system } = buildBookletPrompt(RICH_ORG, RICH_ENRICHMENT);
    assert.match(system, /never invent/i);
  });

  it("instructs the model to keep the booklet short", () => {
    const { system } = buildBookletPrompt(RICH_ORG, RICH_ENRICHMENT);
    assert.match(system, /250 words/);
  });

  it("falls back to city over country_code when both are available", () => {
    const { prompt } = buildBookletPrompt(RICH_ORG, RICH_ENRICHMENT);
    assert.match(prompt, /Location: London/);
  });

  it("treats an empty mission_keywords array the same as a missing one", () => {
    const { prompt } = buildBookletPrompt(RICH_ORG, { ...RICH_ENRICHMENT, mission_keywords: [] });
    assert.match(prompt, /Mission keywords: Not provided/);
  });
});
