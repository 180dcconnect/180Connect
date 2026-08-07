import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { standardizeCompaniesHouseRecord } from "./companies-house.ts";
import type { RawCompaniesHouseRecord } from "./companies-house.ts";

const minimalRecord: RawCompaniesHouseRecord = {
  company_number: "01234567",
  company_name: "Example Charity Ltd",
};

describe("standardizeCompaniesHouseRecord — valid record", () => {
  it("maps the fields a minimal profile provides", () => {
    const org = standardizeCompaniesHouseRecord(minimalRecord);

    assert.equal(org.legal_name, "Example Charity Ltd");
    assert.equal(org.entry_method, "api");
    assert.equal(org.organisation_type, "company");
    assert.equal(org.country_code, "GB");
    assert.equal(org.is_international, false);
    assert.equal(org.is_seed, false);
    assert.equal(org.owner_id, null);
  });

  it("maps the registered office address when the profile has one", () => {
    const enriched: RawCompaniesHouseRecord = {
      ...minimalRecord,
      registered_office_address: {
        address_line_1: "1 High Street",
        locality: "Bristol",
        postal_code: "BS5 0HE",
      },
    };

    const org = standardizeCompaniesHouseRecord(enriched);

    assert.equal(org.address_line_1, "1 High Street");
    assert.equal(org.city, "Bristol");
    assert.equal(org.postcode, "BS5 0HE");
  });
});

describe("standardizeCompaniesHouseRecord — AC2: empty, not omitted", () => {
  it("every text field the source doesn't provide is an empty string, and every key is present", () => {
    const org = standardizeCompaniesHouseRecord(minimalRecord);

    const keys = Object.keys(org);
    assert.ok(keys.includes("website"));
    assert.ok(keys.includes("contact_email"));
    assert.ok(keys.includes("address_line_1"));
    assert.ok(keys.includes("city"));
    assert.ok(keys.includes("postcode"));
    assert.ok(keys.includes("trading_name"));

    // The /company profile endpoint has no contact fields at all, unlike
    // Charity Commission's enrichment calls — these are always empty today.
    assert.equal(org.website, "");
    assert.equal(org.contact_email, "");
    assert.equal(org.address_line_1, "");
    assert.equal(org.city, "");
    assert.equal(org.postcode, "");
    assert.equal(org.trading_name, "");
  });

  it("uses null, not an empty string, for the enum field with no source signal", () => {
    const org = standardizeCompaniesHouseRecord(minimalRecord);
    assert.equal(org.geographic_reach, null);
    assert.notEqual(org.geographic_reach, "");
  });

  it("gives every new record the same starting outreach_status", () => {
    const org = standardizeCompaniesHouseRecord(minimalRecord);
    assert.equal(org.outreach_status, "not_contacted");
  });
});

describe("standardizeCompaniesHouseRecord — invalid / missing fields", () => {
  it("does not throw when company_name is an empty string", () => {
    const raw: RawCompaniesHouseRecord = { ...minimalRecord, company_name: "" };
    assert.doesNotThrow(() => standardizeCompaniesHouseRecord(raw));
    assert.equal(standardizeCompaniesHouseRecord(raw).legal_name, "");
  });

  it("does not throw when company_name is missing entirely", () => {
    const raw = { ...minimalRecord } as Partial<RawCompaniesHouseRecord>;
    delete raw.company_name;
    assert.doesNotThrow(() =>
      standardizeCompaniesHouseRecord(raw as RawCompaniesHouseRecord),
    );
  });

  it("does not throw when registered_office_address is missing entirely", () => {
    assert.doesNotThrow(() => standardizeCompaniesHouseRecord(minimalRecord));
  });
});

describe("standardizeCompaniesHouseRecord — data_completeness_score", () => {
  it("scores a minimal record lower than an enriched one", () => {
    const minimal = standardizeCompaniesHouseRecord(minimalRecord);
    const enriched = standardizeCompaniesHouseRecord({
      ...minimalRecord,
      registered_office_address: {
        address_line_1: "1 High Street",
        locality: "Bristol",
        postal_code: "BS5 0HE",
      },
    });

    assert.ok(enriched.data_completeness_score > minimal.data_completeness_score);
  });

  it("stays within 0 and 1", () => {
    const org = standardizeCompaniesHouseRecord(minimalRecord);
    assert.ok(org.data_completeness_score >= 0);
    assert.ok(org.data_completeness_score <= 1);
  });
});

describe("standardizeCompaniesHouseRecord — legal_name priority note", () => {
  it("documents that Companies House > CharityBase priority is a merge-time rule (F042), not this mapper's", () => {
    // The Data Dictionary's legal_name note says "Companies House takes
    // priority over CharityBase". This mapper only ever inserts a new
    // organisations row (see write-organisations.ts) and never sees an
    // existing CharityBase-derived row to compare against, so it cannot
    // enforce priority between sources — that requires cross-source
    // dedup/merge logic, which is F042's job. Same boundary
    // standardizeCharityCommissionRecord's own out-of-scope test documents.
    assert.ok(true);
  });
});

describe("standardizeCompaniesHouseRecord — out of scope for this module", () => {
  it("documents that duplicate/conflict/merge testing notes belong to F042, not this mapper", () => {
    assert.ok(true);
  });
});
