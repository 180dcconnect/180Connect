import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalisePlaceName } from "./place-name.ts";

describe("normalisePlaceName", () => {
  it("matches a council's name to the plain city", () => {
    assert.equal(normalisePlaceName("Sheffield City"), "sheffield");
    assert.equal(normalisePlaceName("City Of York"), "york");
    assert.equal(normalisePlaceName("Kingston Upon Hull City"), "kingston upon hull");
    assert.equal(normalisePlaceName("Sheffield"), "sheffield");
  });

  it("leaves names that are not council forms alone, apart from case and spacing", () => {
    assert.equal(normalisePlaceName("  South   Yorkshire "), "south yorkshire");
    assert.equal(normalisePlaceName("Southend-on-sea"), "southend-on-sea");
    assert.equal(normalisePlaceName("Rotherham"), "rotherham");
  });

  it("does not strip 'city' from inside a name", () => {
    assert.equal(normalisePlaceName("Cityville"), "cityville");
  });
});
