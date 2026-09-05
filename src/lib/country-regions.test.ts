import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countryToIso } from "./country-flags.ts";
import {
  MAPPED_CODES,
  REGION_ORDER,
  REGION_SHORT,
  regionForIso,
} from "./country-regions.ts";

describe("regionForIso", () => {
  it("places a country in the region a reader would expect", () => {
    assert.equal(regionForIso("KE"), "Africa");
    assert.equal(regionForIso("BD"), "Asia");
    assert.equal(regionForIso("JO"), "Middle East");
    assert.equal(regionForIso("HN"), "Latin America and the Caribbean");
    assert.equal(regionForIso("GB"), "Europe");
    assert.equal(regionForIso("FJ"), "Oceania");
  });

  it("takes a lowercase or padded code", () => {
    assert.equal(regionForIso(" ke "), "Africa");
  });

  it("returns null rather than guessing", () => {
    assert.equal(regionForIso("ZZ"), null);
    assert.equal(regionForIso(null), null);
    assert.equal(regionForIso(""), null);
  });

  it("assigns every country to exactly one region", () => {
    assert.equal(
      MAPPED_CODES.length,
      new Set(MAPPED_CODES).size,
      "a code in two regions would be counted twice in the breakdown",
    );
  });

  it("names every region it can return", () => {
    for (const code of MAPPED_CODES) {
      const region = regionForIso(code)!;
      assert.ok(REGION_ORDER.includes(region), `${region} is missing from REGION_ORDER`);
      assert.ok(REGION_SHORT[region], `${region} has no short label`);
    }
  });
});

/**
 * The contract with the register: every country label it publishes resolves to a
 * region. `country-flags.ts` documents its own coverage of all 275 labels, so
 * checking against that map keeps the two in step without this test needing the
 * register file — which is not in the repo and not built in CI.
 */
describe("register coverage", () => {
  const REGISTER_LABELS = [
    "Afghanistan", "Angola", "Armenia", "Azerbaijan", "Bangladesh", "Bolivia",
    "Brazil", "Burma", "Cambodia", "Central African Republic", "Chad",
    "Colombia", "Congo (Democratic Republic)", "Ethiopia", "Georgia", "Ghana",
    "Guatemala", "Haiti", "Honduras", "India", "Kenya", "Malawi", "Mali",
    "Mozambique", "Nepal", "Niger", "Nigeria", "Pakistan", "Philippines",
    "Rwanda", "Senegal", "Sierra Leone", "Somalia", "South Africa",
    "South Sudan", "Sri Lanka", "Sudan", "Syria", "Tanzania", "Thailand",
    "Uganda", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
  ];

  it("groups every label on a real international charity's return", () => {
    for (const label of REGISTER_LABELS) {
      const iso = countryToIso(label);
      assert.ok(iso, `${label} has no ISO code`);
      assert.ok(regionForIso(iso), `${label} (${iso}) has no region`);
    }
  });
});
