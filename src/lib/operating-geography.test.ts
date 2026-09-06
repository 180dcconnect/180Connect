import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadOperatingGeography } from "./operating-geography.ts";
import { registerUnavailableReason } from "./charity-register/sqlite.ts";
import type { OrganisationDetailRow } from "./client-basic-info.ts";

/**
 * The register file is a 188MB release asset fetched by `prebuild`, so it is
 * present on a developer's machine and in a deployment but never in CI — the
 * tests workflow runs `npm ci` then `npm test` and downloads nothing.
 *
 * Only the first case below reads it. Asserting against a file that is absent
 * half the time makes the whole suite a coin flip, so that one case skips with
 * a reason when there is no register, and the three pure cases always run.
 */
const noRegister = registerUnavailableReason();

function baseOrg(overrides: Partial<OrganisationDetailRow> = {}): OrganisationDetailRow {
  return {
    id: "org-1",
    legal_name: "Action for Community",
    organisation_type: "charity",
    website: "https://example.org",
    contact_email: "contact@example.org",
    address_line_1: "10 High Street",
    city: "Sheffield",
    postcode: "S1 2HE",
    country_code: "GB",
    outreach_status: "not_contacted",
    geographic_reach: "regional",
    ...overrides,
  };
}

describe("loadOperatingGeography", () => {
  it("resolves operational areas for a Charity Commission charity in register.sqlite", {
    skip: noRegister ? `no charity register available: ${noRegister}` : false,
  }, () => {
    // 206476 is CHARLES S FRENCH CHARITABLE TRUST in data/register.sqlite
    const org = baseOrg({
      legal_name: "CHARLES S FRENCH CHARITABLE TRUST",
      organisation_type: "charity",
    });
    const identifiers = [{ identifier_type: "uk_charity", identifier_value: "206476" }];
    const sources = [{ source: "charity_commission_bulk", source_record_id: "206476" }];

    const result = loadOperatingGeography(org, identifiers, sources);

    assert.equal(result.source, "charity_commission");
    assert.equal(result.sourceLabel, "Charity Commission for England and Wales");
    assert.equal(result.registeredCity, "Sheffield");
    assert.equal(result.geographicReach, "regional");
    assert.ok(result.localAuthorities.length > 0);
    assert.ok(result.localAuthorities.includes("Barking And Dagenham"));
    assert.ok(result.totalAreaCount > 0);
  });

  it("handles Companies House entities with no reported operational areas", () => {
    const org = baseOrg({
      legal_name: "Sheffield Community Tech CIC",
      organisation_type: "cic",
      city: "Sheffield",
    });
    const identifiers = [{ identifier_type: "uk_company", identifier_value: "12345678" }];
    const sources = [{ source: "companies_house", source_record_id: "12345678" }];

    const result = loadOperatingGeography(org, identifiers, sources);

    assert.equal(result.source, "companies_house");
    assert.equal(result.sourceLabel, "Companies House");
    assert.deepEqual(result.localAuthorities, []);
    assert.deepEqual(result.regions, []);
    assert.deepEqual(result.countries, []);
    assert.equal(result.totalAreaCount, 0);
    assert.match(result.sourceDescription, /registered office/i);
  });

  it("handles manual entry records gracefully", () => {
    const org = baseOrg({
      legal_name: "Handmade Collective",
      organisation_type: "other",
    });
    const sources = [{ source: "manual", source_record_id: null }];

    const result = loadOperatingGeography(org, [], sources);

    assert.equal(result.source, "manual");
    assert.equal(result.sourceLabel, "Manual Entry");
    assert.equal(result.totalAreaCount, 0);
  });

  it("falls back to registered office when no specific registry areas are found", () => {
    const org = baseOrg({
      legal_name: "Unknown Entity XYZ",
      organisation_type: "other",
    });

    const result = loadOperatingGeography(org, [], []);

    assert.equal(result.source, "registered_office_only");
    assert.equal(result.registeredCity, "Sheffield");
    assert.equal(result.totalAreaCount, 0);
  });
});
