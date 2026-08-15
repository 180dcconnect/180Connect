import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isConfidentMatch,
  standardizeFindThatCharityRecord,
  type RawFindThatCharityRecord,
} from "./find-that-charity.ts";

function record(overrides: Partial<RawFindThatCharityRecord> = {}): RawFindThatCharityRecord {
  return {
    queried_name: "Oxfam",
    name: "Oxfam (GB-CHC-202918)",
    id: "GB-CHC-202918",
    score: 92,
    match: true,
    ...overrides,
  };
}

describe("standardizeFindThatCharityRecord", () => {
  it("maps a confident match into the standard shape", () => {
    const org = standardizeFindThatCharityRecord(record());

    assert.equal(org.legal_name, "Oxfam");
    assert.equal(org.organisation_type, "charity");
    assert.equal(org.entry_method, "api");
    assert.equal(org.country_code, "GB");
    assert.equal(org.outreach_status, "not_contacted");
    assert.equal(org.owner_id, null);
  });

  it("uses queried_name, not Find That Charity's decorated name, as legal_name", () => {
    const org = standardizeFindThatCharityRecord(
      record({
        queried_name: "Oxfam International Tsunami Fund",
        name: "Oxfam International Tsunami Fund (GB-CHC-1108700) [INACTIVE]",
      }),
    );

    assert.equal(org.legal_name, "Oxfam International Tsunami Fund");
  });

  it("stores fields the source doesn't provide as empty, not omitted", () => {
    const org = standardizeFindThatCharityRecord(record());

    assert.equal(org.website, "");
    assert.equal(org.contact_email, "");
    assert.equal(org.address_line_1, "");
    assert.equal(org.city, "");
    assert.equal(org.postcode, "");
    assert.equal(org.trading_name, "");
  });

  it("leaves enum-typed fields with no source signal as null, not empty string", () => {
    const org = standardizeFindThatCharityRecord(record());

    assert.equal(org.geographic_reach, null);
  });

  it("maps an empty queried_name to an empty legal_name rather than throwing", () => {
    const org = standardizeFindThatCharityRecord(record({ queried_name: "" }));

    assert.equal(org.legal_name, "");
  });

  it("computes a completeness score consistent with the mostly-empty shape", () => {
    const org = standardizeFindThatCharityRecord(record());

    assert.ok(org.data_completeness_score > 0);
    assert.ok(org.data_completeness_score < 1);
  });
});

describe("isConfidentMatch", () => {
  it("is confident when match is true", () => {
    assert.equal(isConfidentMatch(record({ match: true })), true);
  });

  it("is not confident when match is false, even with a nonzero score", () => {
    assert.equal(isConfidentMatch(record({ match: false, score: 40 })), false);
  });
});
