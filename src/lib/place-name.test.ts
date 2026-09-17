import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALL_LOCAL_AUTHORITIES } from "./charity-register/vocabulary.ts";
import { displayPlaceName, normalisePlaceName } from "./place-name.ts";

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

describe("displayPlaceName", () => {
  it("writes the plain town a client record holds, keeping its spelling", () => {
    assert.equal(displayPlaceName("Sheffield City"), "Sheffield");
    assert.equal(displayPlaceName("City Of York"), "York");
    assert.equal(displayPlaceName("Kingston Upon Hull City"), "Kingston Upon Hull");
    assert.equal(displayPlaceName("Barking And Dagenham"), "Barking And Dagenham");
  });

  it("agrees with normalisePlaceName, so a picked place matches a recorded one", () => {
    for (const authority of ALL_LOCAL_AUTHORITIES) {
      assert.equal(
        normalisePlaceName(displayPlaceName(authority)),
        normalisePlaceName(authority),
        `${authority} compares differently once stored`,
      );
    }
  });

  it("does not strip 'city' from inside a name", () => {
    assert.equal(displayPlaceName("Cityville"), "Cityville");
  });
});
