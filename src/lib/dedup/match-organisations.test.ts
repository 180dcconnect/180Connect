import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findDuplicateMatch, type ExistingOrganisationForMatch } from "./match-organisations.ts";

function existing(
  overrides: Partial<ExistingOrganisationForMatch> = {},
): ExistingOrganisationForMatch {
  return { id: "org-1", legal_name: "Test Charity", postcode: "SW1A 1AA", ...overrides };
}

describe("findDuplicateMatch — name + postcode", () => {
  it("matches an exact name and postcode", () => {
    const match = findDuplicateMatch(
      { legal_name: "Test Charity", postcode: "SW1A 1AA" },
      [existing()],
    );
    assert.deepEqual(match, { organisationId: "org-1", matchedOn: "name_and_postcode" });
  });

  it("matches 'Ltd' against 'Limited', tolerating the AC's named variant", () => {
    const match = findDuplicateMatch(
      { legal_name: "Test Charity Ltd", postcode: "SW1A 1AA" },
      [existing({ legal_name: "Test Charity Limited", postcode: "SW1A 1AA" })],
    );
    assert.deepEqual(match, { organisationId: "org-1", matchedOn: "name_and_postcode" });
  });

  it("matches despite trailing whitespace and mixed-case postcode formatting", () => {
    const match = findDuplicateMatch(
      { legal_name: "  Test Charity  ", postcode: "sw1a  1aa" },
      [existing({ legal_name: "Test Charity", postcode: "SW1A 1AA" })],
    );
    assert.deepEqual(match, { organisationId: "org-1", matchedOn: "name_and_postcode" });
  });

  it("matches on name alone when either side has no postcode", () => {
    const match = findDuplicateMatch(
      { legal_name: "Test Charity", postcode: "" },
      [existing({ postcode: "" })],
    );
    assert.deepEqual(match, { organisationId: "org-1", matchedOn: "name_and_postcode" });
  });

  it("does not match a genuinely different organisation", () => {
    const match = findDuplicateMatch(
      { legal_name: "Unrelated Charity", postcode: "SW1A 1AA" },
      [existing()],
    );
    assert.equal(match, null);
  });

  it("does not match the same name at a different postcode", () => {
    const match = findDuplicateMatch(
      { legal_name: "Test Charity", postcode: "EC1A 1BB" },
      [existing({ postcode: "SW1A 1AA" })],
    );
    assert.equal(match, null);
  });

  it("returns null for an empty candidate name rather than matching anything", () => {
    const match = findDuplicateMatch({ legal_name: "", postcode: "" }, [existing()]);
    assert.equal(match, null);
  });
});

describe("findDuplicateMatch — registration number", () => {
  it("matches on an overlapping registration number even if the name differs", () => {
    const match = findDuplicateMatch(
      { legal_name: "Test Charity (alt name)", postcode: "", registrationNumbers: ["1234567"] },
      [existing({ registrationNumbers: ["1234567"] })],
    );
    assert.deepEqual(match, { organisationId: "org-1", matchedOn: "registration_number" });
  });

  it("registration number takes priority over a name/postcode mismatch", () => {
    const match = findDuplicateMatch(
      { legal_name: "Totally Different Name", postcode: "EC1A 1BB", registrationNumbers: ["1234567"] },
      [existing({ registrationNumbers: ["1234567"] })],
    );
    assert.equal(match?.matchedOn, "registration_number");
  });
});

describe("findDuplicateMatch — excludeOrganisationIds", () => {
  it("skips an organisation an admin already confirmed is not a duplicate", () => {
    const match = findDuplicateMatch(
      { legal_name: "Test Charity", postcode: "SW1A 1AA" },
      [existing()],
      new Set(["org-1"]),
    );
    assert.equal(match, null);
  });
});
