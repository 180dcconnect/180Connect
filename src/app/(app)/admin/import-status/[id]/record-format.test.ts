import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  describeRawRecord,
  extractFilingType,
  extractMissionOrActivities,
  extractRecordCity,
  extractRecordName,
  extractRecordPostcode,
  extractRegistryStatus,
  extractWebsiteUrl,
  formatFullAddress,
  type RawSourceRecordRow,
} from "./record-format.ts";

/**
 * The staged bulk-charity shape nests everything under `charity`
 * (see toRawPayload). A pending bulk row has no organisation to rescue it, so
 * these extractors are the only thing standing between the breakdown and a
 * bold register number with "Standard client" underneath.
 */
const bulkPayload = {
  charity: {
    organisation_number: 1234567,
    registered_charity_number: 567890,
    charity_name: "Sheffield Arts Collective",
    charity_registration_status: "Registered",
    charity_reporting_status: "Registered",
    date_of_registration: "2015-06-01",
    charity_contact_address1: "12 Division Street",
    charity_contact_address2: "Sheffield",
    charity_contact_address3: null,
    charity_contact_address4: null,
    charity_contact_address5: null,
    charity_contact_postcode: "S1 4GE",
    charity_contact_email: null,
    charity_contact_web: "https://sheffield-arts.example.org",
    charity_company_registration_number: null,
    charity_is_cio: 1,
    charity_activities: "Arts workshops for young people.",
  },
  annual_returns: [],
  matched_classifications: ["Arts"],
  matched_areas: ["Sheffield"],
};

function bulkRow(): RawSourceRecordRow {
  return {
    id: "row-1",
    ingestion_run_id: "run-1",
    record_source: "charity_commission_bulk",
    source_record_id: "1234567",
    raw_payload: bulkPayload,
    received_at: "2026-09-10T10:00:00.000Z",
    processing_status: "pending",
    matched_organisation_id: null,
    checksum: "abc",
    ingestion_attempt: 1,
    source_country: "GB",
    source_registry_name: "Charity Commission for England and Wales",
    excluded_fields: [],
    rule_version_applied: 1,
  };
}

describe("bulk charity payload", () => {
  it("names the charity, not its register number", () => {
    assert.equal(extractRecordName(bulkPayload, "1234567"), "Sheffield Arts Collective");
  });

  it("reads the postcode where no town is staged", () => {
    assert.equal(extractRecordCity(bulkPayload), null);
    assert.equal(extractRecordPostcode(bulkPayload), "S1 4GE");
  });

  it("reads activities, website, address and status from the nested charity", () => {
    assert.equal(extractMissionOrActivities(bulkPayload), "Arts workshops for young people.");
    assert.equal(extractWebsiteUrl(bulkPayload), "https://sheffield-arts.example.org");
    assert.equal(formatFullAddress(bulkPayload), "12 Division Street, Sheffield, S1 4GE");
    assert.equal(extractRegistryStatus(bulkPayload), "Registered");
  });

  it("reads the CIO flag as the filing type", () => {
    assert.equal(extractFilingType(bulkPayload), "Charitable Incorporated Organisation (CIO)");
  });

  it("calls a non-CIO bulk row a registered charity, never a standard client", () => {
    const payload = {
      charity: { ...bulkPayload.charity, charity_is_cio: 0 },
      annual_returns: [],
    };
    assert.equal(extractFilingType(payload), "Registered Charity");
  });

  it("describes a pending bulk row by name with a location", () => {
    const view = describeRawRecord(bulkRow(), null, new Date("2026-09-11T10:00:00.000Z"));
    assert.equal(view.name, "Sheffield Arts Collective");
    assert.equal(view.city, null);
    assert.equal(view.postcode, "S1 4GE");
    assert.equal(view.status.label, "Pending Review");
  });

  it("never misreads a payload that merely happens to carry a charity key", () => {
    // No annual_returns marker: not the staged register shape.
    const lookalike = { charity: { charity_name: "Someone Else" } };
    assert.equal(extractRecordName(lookalike, "999"), "999");
    assert.equal(extractFilingType(lookalike), null);
  });
});

describe("flat payloads", () => {
  it("keeps preferring top-level names", () => {
    assert.equal(extractRecordName({ legal_name: "Flat Ltd" }, "1"), "Flat Ltd");
    assert.equal(extractRecordName({ company_name: "Flat Co" }, "1"), "Flat Co");
  });
});
