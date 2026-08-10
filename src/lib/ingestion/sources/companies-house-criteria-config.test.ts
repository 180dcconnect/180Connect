import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyCompaniesHouseTier } from "./companies-house-criteria-config.ts";

describe("classifyCompaniesHouseTier", () => {
  it("classifies a CIO as Tier A regardless of SIC codes", () => {
    assert.equal(
      classifyCompaniesHouseTier({ company_type: "charitable-incorporated-organisation" }),
      "A",
    );
  });

  it("classifies an FE college corporation as Tier A", () => {
    assert.equal(
      classifyCompaniesHouseTier({ company_type: "further-education-or-sixth-form-college-corporation" }),
      "A",
    );
  });

  it("classifies a CIC-registered ltd as Tier B", () => {
    assert.equal(
      classifyCompaniesHouseTier({ company_type: "ltd", company_subtype: "community-interest-company" }),
      "B",
    );
  });

  it("does not classify an ordinary ltd with no CIC subtype as Tier B", () => {
    assert.equal(classifyCompaniesHouseTier({ company_type: "ltd" }), null);
  });

  it("classifies a royal-charter body with an allowlisted SIC code as Tier C", () => {
    assert.equal(
      classifyCompaniesHouseTier({ company_type: "royal-charter", sic_codes: ["86900"] }),
      "C",
    );
  });

  it("does not classify a royal-charter body with no matching SIC code as Tier C", () => {
    assert.equal(
      classifyCompaniesHouseTier({ company_type: "royal-charter", sic_codes: ["64209"] }),
      null,
    );
  });

  it("does not classify a royal-charter body with no SIC codes at all", () => {
    assert.equal(classifyCompaniesHouseTier({ company_type: "royal-charter" }), null);
  });

  it("returns null for a plc with no matching tier", () => {
    assert.equal(classifyCompaniesHouseTier({ company_type: "plc" }), null);
  });

  it("tolerates a malformed sic_codes value instead of throwing", () => {
    assert.equal(
      classifyCompaniesHouseTier({ company_type: "royal-charter", sic_codes: "86900" as unknown as string[] }),
      null,
    );
  });
});
