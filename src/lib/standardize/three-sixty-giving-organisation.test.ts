import assert from "node:assert/strict";
import { test } from "node:test";
import { standardizeThreeSixtyGivingOrganisationRecord } from "./three-sixty-giving-organisation.ts";

test("maps a charity recipient into the ORGANISATIONS shape", () => {
  const org = standardizeThreeSixtyGivingOrganisationRecord({
    recipientOrganization: [{ name: "Example Trust", charityNumber: "1164883" }],
  });

  assert.equal(org.legal_name, "Example Trust");
  assert.equal(org.organisation_type, "charity");
  assert.equal(org.country_code, "GB");
  assert.equal(org.entry_method, "api");
});

test("maps a company-only recipient to organisation_type company", () => {
  const org = standardizeThreeSixtyGivingOrganisationRecord({
    recipientOrganization: [{ name: "Example Co", companyNumber: "09668396" }],
  });

  assert.equal(org.organisation_type, "company");
});

test("maps a dual-registered recipient to organisation_type both", () => {
  const org = standardizeThreeSixtyGivingOrganisationRecord({
    recipientOrganization: [
      { name: "Dual Reg Org", charityNumber: "1164883", companyNumber: "09668396" },
    ],
  });

  assert.equal(org.organisation_type, "both");
});

test("maps a recipient with neither number to organisation_type other", () => {
  const org = standardizeThreeSixtyGivingOrganisationRecord({
    recipientOrganization: [{ name: "Unregistered Group" }],
  });

  assert.equal(org.organisation_type, "other");
});

test("AC2: fields the source never provides are empty strings or null, not omitted", () => {
  const org = standardizeThreeSixtyGivingOrganisationRecord({
    recipientOrganization: [{ name: "Example Trust", charityNumber: "1164883" }],
  });

  assert.equal(org.website, "");
  assert.equal(org.contact_email, "");
  assert.equal(org.address_line_1, "");
  assert.equal(org.city, "");
  assert.equal(org.postcode, "");
  assert.equal(org.trading_name, "");
  assert.equal(org.geographic_reach, null);
});

test("a record with no recipientOrganization at all still returns a complete, empty-shaped record", () => {
  const org = standardizeThreeSixtyGivingOrganisationRecord({});

  assert.equal(org.legal_name, "");
  assert.equal(org.organisation_type, "other");
  assert.equal(typeof org.data_completeness_score, "number");
});

test("non-string name/registration values are treated as absent, not stringified", () => {
  const org = standardizeThreeSixtyGivingOrganisationRecord({
    recipientOrganization: [{ name: 12345, charityNumber: null }],
  });

  assert.equal(org.legal_name, "");
  assert.equal(org.organisation_type, "other");
});

test("outreach_status and owner_id default the same as every other source mapper", () => {
  const org = standardizeThreeSixtyGivingOrganisationRecord({
    recipientOrganization: [{ name: "Example Trust", charityNumber: "1164883" }],
  });

  assert.equal(org.outreach_status, "not_contacted");
  assert.equal(org.owner_id, null);
  assert.equal(org.is_seed, false);
});
