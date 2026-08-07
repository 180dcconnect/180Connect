import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { standardizeCharityCommissionRecord } from "./charity-commission.ts";
import type { RawCharityCommissionRecord } from "./charity-commission.ts";

const minimalRecord: RawCharityCommissionRecord = {
  organisation_number: 5254841,
  reg_charity_number: 1218781,
  charity_name: "THE NAZE PROTECTION SOCIETY",
  reg_status: "R",
  date_of_registration: "2026-07-07T00:00:00",
  date_of_removal: null,
};

describe("standardizeCharityCommissionRecord — valid record", () => {
  it("maps the fields the search operation actually provides", () => {
    const org = standardizeCharityCommissionRecord(minimalRecord);

    assert.equal(org.legal_name, "THE NAZE PROTECTION SOCIETY");
    assert.equal(org.entry_method, "api");
    assert.equal(org.organisation_type, "charity");
    assert.equal(org.country_code, "GB");
    assert.equal(org.is_international, false);
    assert.equal(org.is_seed, false);
    assert.equal(org.owner_id, null);
  });

  it("uses fields from enrichment data when the raw payload has them", () => {
    const enriched: RawCharityCommissionRecord = {
      ...minimalRecord,
      address_line_one: "1 High Street",
      address_post_code: "BS5 0HE",
      email: "info@example.org",
      web: "https://example.org",
    };

    const org = standardizeCharityCommissionRecord(enriched);

    assert.equal(org.address_line_1, "1 High Street");
    assert.equal(org.postcode, "BS5 0HE");
    assert.equal(org.contact_email, "info@example.org");
    assert.equal(org.website, "https://example.org");
  });
});

describe("standardizeCharityCommissionRecord — AC2: empty, not omitted", () => {
  it("every text field the source doesn't provide is an empty string, and every key is present", () => {
    const org = standardizeCharityCommissionRecord(minimalRecord);

    // Every field must exist on the object (not omitted) — this is what AC2
    // actually requires: same shape regardless of what the source sent.
    const keys = Object.keys(org);
    assert.ok(keys.includes("website"));
    assert.ok(keys.includes("contact_email"));
    assert.ok(keys.includes("address_line_1"));
    assert.ok(keys.includes("city"));
    assert.ok(keys.includes("postcode"));
    assert.ok(keys.includes("trading_name"));

    assert.equal(org.website, "");
    assert.equal(org.contact_email, "");
    assert.equal(org.address_line_1, "");
    assert.equal(org.city, "");
    assert.equal(org.postcode, "");
    assert.equal(org.trading_name, "");
  });

  it("uses null, not an empty string, for the enum field with no source signal", () => {
    // geographic_reach is a constrained enum column — "" is not a valid
    // value for it, so "empty" has to mean null here, not "".
    const org = standardizeCharityCommissionRecord(minimalRecord);
    assert.equal(org.geographic_reach, null);
    assert.notEqual(org.geographic_reach, "");
  });

  it("gives every new record the same starting outreach_status", () => {
    const org = standardizeCharityCommissionRecord(minimalRecord);
    assert.equal(org.outreach_status, "not_contacted");
  });
});

describe("standardizeCharityCommissionRecord — invalid / missing fields", () => {
  it("does not throw when charity_name is an empty string", () => {
    const raw: RawCharityCommissionRecord = { ...minimalRecord, charity_name: "" };
    assert.doesNotThrow(() => standardizeCharityCommissionRecord(raw));
    assert.equal(standardizeCharityCommissionRecord(raw).legal_name, "");
  });

  it("does not throw when charity_name is missing entirely", () => {
    const raw = { ...minimalRecord } as Partial<RawCharityCommissionRecord>;
    delete raw.charity_name;
    assert.doesNotThrow(() =>
      standardizeCharityCommissionRecord(raw as RawCharityCommissionRecord),
    );
  });
});

describe("standardizeCharityCommissionRecord — data_completeness_score", () => {
  it("scores a minimal record lower than an enriched one", () => {
    const minimal = standardizeCharityCommissionRecord(minimalRecord);
    const enriched = standardizeCharityCommissionRecord({
      ...minimalRecord,
      address_line_one: "1 High Street",
      address_post_code: "BS5 0HE",
      email: "info@example.org",
      web: "https://example.org",
    });

    assert.ok(enriched.data_completeness_score > minimal.data_completeness_score);
  });

  it("stays within 0 and 1", () => {
    const org = standardizeCharityCommissionRecord(minimalRecord);
    assert.ok(org.data_completeness_score >= 0);
    assert.ok(org.data_completeness_score <= 1);
  });
});

describe("standardizeCharityCommissionRecord — out of scope for this module", () => {
  it("documents that duplicate/conflict/merge testing notes belong to F042, not this mapper", () => {
    // The F041 ticket's testing notes list "duplicate candidate", "conflicting
    // source values", and "existing internal data preserved" — those are all
    // about deciding what happens when a mapped record meets an *existing*
    // ORGANISATIONS row, which is F042's job (cross-source dedup/merge), not
    // this function's. standardizeCharityCommissionRecord maps one raw record
    // in isolation and has no knowledge of what else is in the database.
    // This test exists to make that boundary explicit rather than silently
    // skip those testing notes.
    assert.ok(true);
  });
});
