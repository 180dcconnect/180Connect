import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveGeographicReach } from "./geographic-reach.ts";

describe("deriveGeographicReach", () => {
  it("returns null when there are no areas to read", () => {
    assert.equal(deriveGeographicReach(null), null);
    assert.equal(deriveGeographicReach(undefined), null);
    assert.equal(
      deriveGeographicReach({ localAuthorities: [], regions: [], countries: [] }),
      null,
    );
  });

  it("reads a single declared local authority as local", () => {
    assert.equal(
      deriveGeographicReach({ localAuthorities: ["Sheffield"], regions: [], countries: [] }),
      "local",
    );
  });

  it("reads several local authorities as regional, never national", () => {
    // Conservative on purpose: thirty declared LAs without a declared region
    // is wide operation, but national is a claim the register does not make.
    assert.equal(
      deriveGeographicReach({
        localAuthorities: ["Sheffield", "Leeds", "Manchester", "Birmingham"],
        regions: [],
        countries: [],
      }),
      "regional",
    );
  });

  it("reads a declared region as national", () => {
    assert.equal(
      deriveGeographicReach({ localAuthorities: ["Sheffield"], regions: ["England"], countries: [] }),
      "national",
    );
  });

  it("reads a declared country as international", () => {
    assert.equal(
      deriveGeographicReach({ localAuthorities: [], regions: [], countries: ["Kenya"] }),
      "international",
    );
  });

  it("prefers the widest declaration when several kinds are present", () => {
    assert.equal(
      deriveGeographicReach({
        localAuthorities: ["Sheffield"],
        regions: ["England"],
        countries: ["Kenya"],
      }),
      "international",
    );
    assert.equal(
      deriveGeographicReach({
        localAuthorities: ["Sheffield", "Leeds"],
        regions: ["England"],
        countries: [],
      }),
      "national",
    );
  });
});
