import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeRawRecord,
  extractMissionOrActivities,
  extractRecordName,
  formatFullAddress,
  getStatusDetails,
  humaniseEntityType,
  matchesRecordQuery,
  type RawSourceRecordRow,
} from "./record-format.ts";

const NOW = new Date("2026-08-15T12:00:00.000Z");

function fakeRow(overrides: Partial<RawSourceRecordRow> = {}): RawSourceRecordRow {
  return {
    id: "rec-1",
    ingestion_run_id: "run-1",
    record_source: "companies_house",
    source_record_id: "01234567",
    raw_payload: {
      company_name: "Acme Innovations CIC",
      type: "community-interest-company",
      company_status: "active",
      registered_office_address: {
        address_line_1: "10 High Street",
        locality: "London",
        postal_code: "EC1A 1AA",
      },
      sic_codes: ["88990"],
    },
    received_at: "2026-08-15T10:00:00.000Z",
    processing_status: "validated",
    matched_organisation_id: "org-1",
    checksum: "a1b2c3d4e5f67890",
    ingestion_attempt: 1,
    source_country: "GB",
    source_registry_name: "Companies House",
    excluded_fields: ["contact_email"],
    rule_version_applied: 1,
    ...overrides,
  };
}

describe("extractRecordName", () => {
  it("extracts legal_name or company_name or charity_name", () => {
    assert.equal(extractRecordName({ legal_name: "Oxfam GB" }, "123"), "Oxfam GB");
    assert.equal(extractRecordName({ company_name: "Tesla UK Ltd" }, "123"), "Tesla UK Ltd");
    assert.equal(extractRecordName({ charity_name: "Red Cross" }, "123"), "Red Cross");
    assert.equal(extractRecordName({ name: "Save The Children" }, "123"), "Save The Children");
  });

  it("extracts recipientOrganization from 360Giving payload", () => {
    assert.equal(
      extractRecordName({ recipientOrganization: [{ name: "Youth Impact Fund" }] }, "123"),
      "Youth Impact Fund",
    );
  });

  it("falls back to fallback ID on missing or empty payload", () => {
    assert.equal(extractRecordName(null, "01234567"), "01234567");
    assert.equal(extractRecordName({}, "01234567"), "01234567");
  });
});

describe("humaniseEntityType", () => {
  it("converts raw registry codes into readable names", () => {
    assert.equal(humaniseEntityType("community-interest-company"), "Community Interest Company (CIC)");
    assert.equal(humaniseEntityType("cic"), "Community Interest Company (CIC)");
    assert.equal(humaniseEntityType("private-limited-guarant-nsc"), "Company Limited by Guarantee (Non-profit)");
    assert.equal(humaniseEntityType("registered-charity"), "Registered Charity");
  });
});

describe("formatFullAddress", () => {
  it("formats registered office address into a clean line", () => {
    const formatted = formatFullAddress({
      registered_office_address: {
        address_line_1: "123 Oxford Street",
        locality: "London",
        postal_code: "W1D 2HG",
      },
    });
    assert.equal(formatted, "123 Oxford Street, London, W1D 2HG");
  });
});

describe("extractMissionOrActivities", () => {
  it("extracts activities or mission statement", () => {
    assert.equal(
      extractMissionOrActivities({ activities: "Providing youth mentorship." }),
      "Providing youth mentorship.",
    );
    assert.equal(
      extractMissionOrActivities({ sic_codes: ["88990"] }),
      "Nature of business (SIC codes): 88990",
    );
  });
});

describe("getStatusDetails", () => {
  it("returns human-friendly business status labels", () => {
    assert.equal(getStatusDetails("validated").label, "Added to CRM");
    assert.equal(getStatusDetails("matched").label, "Duplicate Candidate");
    assert.equal(getStatusDetails("pending").label, "Pending Review");
    assert.equal(getStatusDetails("rejected").label, "Excluded by Criteria");
    assert.equal(getStatusDetails("error").label, "Import Issue");
  });
});

describe("describeRawRecord", () => {
  it("formats a raw record with business presentation", () => {
    const view = describeRawRecord(fakeRow(), null, NOW);
    assert.equal(view.name, "Acme Innovations CIC");
    assert.equal(view.city, "London");
    assert.equal(view.filingType, "Community Interest Company (CIC)");
    assert.equal(view.fullAddress, "10 High Street, London, EC1A 1AA");
    assert.equal(view.registryStatus, "Active");
    assert.equal(view.receivedRelative, "2 hours ago");
  });
});

describe("matchesRecordQuery", () => {
  const view = describeRawRecord(fakeRow(), null, NOW);

  it("matches name, registration number, city, or address", () => {
    assert.equal(matchesRecordQuery(view, "acme"), true);
    assert.equal(matchesRecordQuery(view, "01234567"), true);
    assert.equal(matchesRecordQuery(view, "london"), true);
    assert.equal(matchesRecordQuery(view, "high street"), true);
  });
});
