import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toRawPayload } from "./import.ts";
import type { RegisterCompany } from "./sqlite.ts";
import { classifyCompaniesHouseTier } from "../ingestion/sources/companies-house-criteria-config.ts";
import { classifyCompaniesHouseSourceConfidence, type RawCompaniesHouseRecord } from "../standardize/companies-house.ts";

function company(overrides: Partial<RegisterCompany> = {}): RegisterCompany {
  return {
    number: "12345678",
    name: "Example CIC",
    cat_slug: "community-interest-company",
    status_raw: "Active",
    status_norm: "active",
    incorp_date: "2020-02-01",
    postcode: "S1 2HE",
    postcode_area: "S",
    town: "Sheffield",
    address_line_1: "1 Example Street",
    is_cic: 1,
    ...overrides,
  };
}

describe("toRawPayload", () => {
  it("speaks the API field names the standardiser reads", () => {
    const payload = toRawPayload(company(), ["88990"]) as Record<string, unknown>;
    assert.equal(payload.company_name, "Example CIC");
    assert.equal(payload.company_type, "community-interest-company");
    assert.equal(payload.company_subtype, "community-interest-company");
    assert.deepEqual(payload.sic_codes, ["88990"]);
    assert.equal(payload.company_status, "active");
    assert.deepEqual(payload.registered_office_address, {
      address_line_1: "1 Example Street",
      locality: "Sheffield",
      postal_code: "S1 2HE",
    });
  });

  it("omits empty address parts and the subtype for non-CICs", () => {
    const payload = toRawPayload(
      company({ cat_slug: "ltd", is_cic: 0, town: null, address_line_1: null }),
      ["86101"],
    ) as Record<string, unknown>;
    assert.ok(!("company_subtype" in payload));
    assert.deepEqual(payload.registered_office_address, { postal_code: "S1 2HE" });
  });

  it("a file-sourced CIC keeps its strong-evidence bypass end to end", () => {
    // The payload must classify Tier B through the shared classifier — the
    // F047 bypass the promote path applies — not through a special case.
    const payload = toRawPayload(company(), ["88990"]) as unknown as RawCompaniesHouseRecord;
    assert.equal(classifyCompaniesHouseTier(payload), "B");
    assert.equal(classifyCompaniesHouseSourceConfidence(payload), "strong");
  });

  it("a file-sourced CIO classifies Tier A", () => {
    const payload = toRawPayload(
      company({ cat_slug: "charitable-incorporated-organisation", is_cic: 0 }),
      [],
    ) as unknown as RawCompaniesHouseRecord;
    assert.equal(classifyCompaniesHouseTier(payload), "A");
  });
});
