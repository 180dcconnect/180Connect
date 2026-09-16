import assert from "node:assert/strict";
import { test } from "node:test";

import { reachPatchFor, type StoredReach } from "./reach-backfill.ts";

/** A charity as the import left it before the reach derive existed: on the
 *  client list, identified, and empty in the one column this job fills. */
function stored(overrides: Partial<StoredReach> = {}): StoredReach {
  return {
    id: "fbbda4a1-46f6-4ba0-81c1-387822667c56",
    geographic_reach: null,
    legal_name: "Sheffield Wildlife Fund",
    trading_name: "",
    website: "",
    contact_email: "",
    address_line_1: "1 Division Street",
    city: "Sheffield",
    postcode: "S1 4GF",
    data_completeness_score: 0.5,
    ...overrides,
  };
}

/** The register's declared areas for the same charity. */
function areas(overrides: Partial<Parameters<typeof reachPatchFor>[1]> = {}) {
  return {
    localAuthorities: ["Sheffield"],
    regions: [],
    countries: [],
    ...overrides,
  } as NonNullable<Parameters<typeof reachPatchFor>[1]>;
}

test("fills an empty reach from the declared areas", () => {
  const patch = reachPatchFor(stored(), areas());
  assert.equal(patch?.geographic_reach, "local");
});

test("climbs the ladder the same way the import does", () => {
  assert.equal(
    reachPatchFor(stored(), areas({ localAuthorities: ["Sheffield", "Leeds"] }))
      ?.geographic_reach,
    "regional",
  );
  assert.equal(
    reachPatchFor(stored(), areas({ regions: ["England"] }))?.geographic_reach,
    "national",
  );
  assert.equal(
    reachPatchFor(stored(), areas({ countries: ["Kenya"] }))?.geographic_reach,
    "international",
  );
});

test("never touches a reach someone already answered", () => {
  // The admin correction case: a human set it to local, and the register says
  // international. A patch here would overwrite their answer on every run.
  assert.equal(
    reachPatchFor(stored({ geographic_reach: "local" }), areas({ countries: ["Kenya"] })),
    null,
  );
});

test("a charity declaring nothing is not a gap this job can fill", () => {
  assert.equal(reachPatchFor(stored(), areas({ localAuthorities: [] })), null);
  assert.equal(reachPatchFor(stored(), null), null);
});

test("recomputes the completeness score with the field filled", () => {
  // Four of the eight scoreable fields held (name, address, city, postcode),
  // plus reach = five.
  const patch = reachPatchFor(stored(), areas());
  assert.equal(patch?.data_completeness_score, Math.round((5 / 8) * 100) / 100);
});

test("the score counts the row it is stored beside, not the old one", () => {
  // Same charity with a website and an email on file: the score has to move
  // with them, not restate whatever was written when the row was inserted.
  // Seven of eight — no trading name on this record.
  const patch = reachPatchFor(
    stored({
      website: "https://example.org",
      contact_email: "hello@example.org",
      data_completeness_score: 0.12,
    }),
    areas(),
  );
  assert.equal(patch?.data_completeness_score, Math.round((7 / 8) * 100) / 100);
});
