import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  districtsFromLookup,
  looksLikePostcode,
  lookupPostcodePlaces,
  placeSearchUrl,
  placesFromSearch,
  postcodeLookupUrl,
  searchPlacesByName,
  type PostcodeLookupDependencies,
} from "./postcode-lookup.ts";

// The fetch is injected, so these drive the decision logic without a network —
// same split as mission-from-website.test.ts and sector-from-website.test.ts.

function depsReturning(payload: unknown | null, seen?: { url: string }): PostcodeLookupDependencies {
  return {
    fetchJson: async (url) => {
      if (seen) seen.url = url;
      return payload;
    },
  };
}

describe("looksLikePostcode", () => {
  it("accepts a full postcode however it is spaced or cased", () => {
    assert.equal(looksLikePostcode("S1 2HH"), true);
    assert.equal(looksLikePostcode("s12hh"), true);
    assert.equal(looksLikePostcode("  SW1A 1AA "), true);
  });

  it("accepts an outward code on its own", () => {
    assert.equal(looksLikePostcode("S60"), true);
    assert.equal(looksLikePostcode("DN1"), true);
    assert.equal(looksLikePostcode("EC1A"), true);
  });

  it("ignores ordinary place searches, so typing a name asks nobody anything", () => {
    assert.equal(looksLikePostcode("Sheffield"), false);
    assert.equal(looksLikePostcode("Barking And Dagenham"), false);
    assert.equal(looksLikePostcode(""), false);
    assert.equal(looksLikePostcode(null), false);
  });
});

describe("postcodeLookupUrl", () => {
  it("asks the postcode endpoint for a full postcode", () => {
    assert.equal(postcodeLookupUrl("s1 2hh"), "https://api.postcodes.io/postcodes/S12HH");
  });

  it("asks the outcode endpoint for an outward code", () => {
    assert.equal(postcodeLookupUrl("S60"), "https://api.postcodes.io/outcodes/S60");
  });

  it("asks nothing for text that is not a postcode", () => {
    assert.equal(postcodeLookupUrl("Sheffield"), null);
  });
});

describe("districtsFromLookup", () => {
  it("reads the one district a full postcode sits in", () => {
    assert.deepEqual(
      districtsFromLookup({ result: { admin_district: "Sheffield", parish: "Sheffield" } }),
      ["Sheffield"],
    );
  });

  it("reads every district an outward code touches", () => {
    assert.deepEqual(
      districtsFromLookup({ result: { admin_district: ["Rotherham", "Sheffield"] } }),
      ["Rotherham", "Sheffield"],
    );
  });

  it("ignores the parish and ward — smaller than anything a record holds", () => {
    assert.deepEqual(
      districtsFromLookup({
        result: { admin_district: ["Rotherham"], parish: ["Brinsworth"], admin_ward: ["Sitwell"] },
      }),
      ["Rotherham"],
    );
  });

  it("survives a body that is not the shape it promised", () => {
    assert.deepEqual(districtsFromLookup(null), []);
    assert.deepEqual(districtsFromLookup("nope"), []);
    assert.deepEqual(districtsFromLookup({ result: { admin_district: [null, 7, ""] } }), []);
  });
});

describe("lookupPostcodePlaces", () => {
  it("returns the places a postcode sits in", async () => {
    const seen = { url: "" };
    const result = await lookupPostcodePlaces(
      "s1 2hh",
      depsReturning({ result: { admin_district: "Sheffield" } }, seen),
    );
    assert.equal(seen.url, "https://api.postcodes.io/postcodes/S12HH");
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.deepEqual(result.districts, ["Sheffield"]);
    assert.equal(result.postcode, "S12HH");
  });

  it("returns both councils an outward code straddles rather than picking one", async () => {
    const result = await lookupPostcodePlaces(
      "S60",
      depsReturning({ result: { admin_district: ["Rotherham", "Sheffield"] } }),
    );
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.deepEqual(result.districts, ["Rotherham", "Sheffield"]);
  });

  it("says plainly when there is no such postcode", async () => {
    const result = await lookupPostcodePlaces("S1 2HH", depsReturning(null));
    assert.equal(result.status, "not_found");
  });

  it("says plainly when the service cannot be reached, and never throws", async () => {
    const result = await lookupPostcodePlaces("S1 2HH", {
      fetchJson: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(result.status, "unavailable");
    if (result.status !== "unavailable") return;
    assert.match(result.message, /Search for the place by name instead/);
  });

  it("asks nobody anything about text that is not a postcode", async () => {
    let called = false;
    const result = await lookupPostcodePlaces("Sheffield", {
      fetchJson: async () => {
        called = true;
        return null;
      },
    });
    assert.equal(called, false);
    assert.equal(result.status, "not_found");
  });
});

describe("placeSearchUrl", () => {
  it("asks the places endpoint once there is enough to search for", () => {
    assert.equal(
      placeSearchUrl("Colchester"),
      "https://api.postcodes.io/places?q=Colchester&limit=20",
    );
  });

  it("asks nothing for a search too short to mean anything", () => {
    assert.equal(placeSearchUrl("co"), null);
    assert.equal(placeSearchUrl(" "), null);
  });
});

describe("placesFromSearch", () => {
  const colchester = {
    name_1: "Colchester",
    local_type: "City",
    county_unitary: "Essex",
    district_borough: "Colchester",
  };

  it("reads the town the Charity Commission's upper-tier list does not have", () => {
    assert.deepEqual(placesFromSearch({ result: [colchester] }), [
      { name: "Colchester", county: "Essex" },
    ]);
  });

  it("drops the kinds of place a client cannot sit in", () => {
    const places = placesFromSearch({
      result: [
        colchester,
        { name_1: "Colchester Green", local_type: "Hamlet", county_unitary: "Suffolk" },
        { name_1: "Little Colchester", local_type: "Farmstead", county_unitary: "Suffolk" },
      ],
    });
    assert.deepEqual(places, [{ name: "Colchester", county: "Essex" }]);
  });

  it("keeps two places that share a name but not a county", () => {
    const places = placesFromSearch({
      result: [
        { name_1: "Newport", local_type: "Town", county_unitary: "Newport" },
        { name_1: "Newport", local_type: "Town", county_unitary: "Essex" },
        { name_1: "Newport", local_type: "Town", county_unitary: "Essex" },
      ],
    });
    assert.deepEqual(places, [
      { name: "Newport", county: "Newport" },
      { name: "Newport", county: "Essex" },
    ]);
  });

  it("survives a body that is not the shape it promised", () => {
    assert.deepEqual(placesFromSearch(null), []);
    assert.deepEqual(placesFromSearch({ result: "nope" }), []);
    assert.deepEqual(placesFromSearch({ result: [null, 7, { name_1: "" }] }), []);
  });
});

describe("searchPlacesByName", () => {
  it("returns the places it found", async () => {
    const seen = { url: "" };
    const result = await searchPlacesByName(
      "Colchester",
      depsReturning(
        { result: [{ name_1: "Colchester", local_type: "City", county_unitary: "Essex" }] },
        seen,
      ),
    );
    assert.match(seen.url, /places\?q=Colchester/);
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.deepEqual(result.places, [{ name: "Colchester", county: "Essex" }]);
  });

  it("says plainly when nothing is called that", async () => {
    const result = await searchPlacesByName("Zzzzborough", depsReturning({ result: [] }));
    assert.equal(result.status, "none");
  });

  it("says plainly when the service cannot be reached, and never throws", async () => {
    const result = await searchPlacesByName("Colchester", {
      fetchJson: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(result.status, "unavailable");
  });
});
