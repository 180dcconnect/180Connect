import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findImportDuplicateMatch,
  normaliseHostname,
  type ExistingOrganisationForImportMatch,
} from "./duplicate-detection.ts";

const EXISTING_ORGS: ExistingOrganisationForImportMatch[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    legal_name: "British Heart Foundation",
    postcode: "NW1 7AW",
    website: "https://www.bhf.org.uk",
    registrationNumbers: ["225971", "00699547"],
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    legal_name: "Sheffield Wildlife Trust Limited",
    postcode: "S11 8PN",
    website: "https://www.wildsheffield.com",
    registrationNumbers: ["1101126"],
  },
];

describe("normaliseHostname", () => {
  it("normalises standard https URLs", () => {
    assert.equal(normaliseHostname("https://www.bhf.org.uk/what-we-do"), "bhf.org.uk");
    assert.equal(normaliseHostname("http://bhf.org.uk"), "bhf.org.uk");
  });

  it("handles missing protocols and trailing slashes", () => {
    assert.equal(normaliseHostname("wildsheffield.com/"), "wildsheffield.com");
  });

  it("returns null for empty or invalid inputs", () => {
    assert.equal(normaliseHostname(""), null);
    assert.equal(normaliseHostname("   "), null);
    assert.equal(normaliseHostname(null), null);
    assert.equal(normaliseHostname(undefined), null);
  });
});

describe("findImportDuplicateMatch", () => {
  it("matches on registration number", () => {
    const match = findImportDuplicateMatch(
      {
        legalName: "Unknown Charity Name",
        postcode: "XY1 1ZZ",
        website: "https://different-site.org",
        registrationNumbers: ["225971"],
      },
      EXISTING_ORGS,
    );

    assert.deepEqual(match, {
      organisationId: "11111111-1111-1111-1111-111111111111",
      matchedOn: "registration_number",
    });
  });

  it("matches on normalised name + postcode (F042)", () => {
    const match = findImportDuplicateMatch(
      {
        legalName: "Sheffield Wildlife Trust",
        postcode: "s11 8pn",
        website: "https://some-other-domain.org",
      },
      EXISTING_ORGS,
    );

    assert.deepEqual(match, {
      organisationId: "22222222-2222-2222-2222-222222222222",
      matchedOn: "name_and_postcode",
    });
  });

  it("matches on website origin when name or reg numbers differ", () => {
    const match = findImportDuplicateMatch(
      {
        legalName: "BHF Research Hub",
        postcode: null,
        website: "https://bhf.org.uk/research/grants",
      },
      EXISTING_ORGS,
    );

    assert.deepEqual(match, {
      organisationId: "11111111-1111-1111-1111-111111111111",
      matchedOn: "website",
    });
  });

  it("returns null when no candidate matches", () => {
    const match = findImportDuplicateMatch(
      {
        legalName: "Brand New Charity",
        postcode: "E1 6AN",
        website: "https://brandnewcharity.org",
        registrationNumbers: ["9999999"],
      },
      EXISTING_ORGS,
    );

    assert.equal(match, null);
  });
});
