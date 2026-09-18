import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  previewCompany,
  type CompanyPreviewDependencies,
  type CompanyProfilePayload,
} from "./company-preview.ts";

function record(overrides: Partial<CompanyProfilePayload> = {}): CompanyProfilePayload {
  return {
    company_name: "Sheffield Community Hub CIC",
    company_type: "ltd",
    company_subtype: "community-interest-company",
    company_status: "active",
    date_of_creation: "2018-05-10",
    date_of_cessation: undefined,
    sic_codes: ["88990"],
    registered_office_address: {
      address_line_1: "42 Broad Lane",
      locality: "Sheffield",
      postal_code: "S1 4BT",
    },
    ...overrides,
  };
}

function deps(
  fetchRecord: CompanyPreviewDependencies["fetchRecord"],
): CompanyPreviewDependencies {
  return { fetchRecord };
}

describe("previewCompany", () => {
  it("returns what the importer would write, without writing it", async () => {
    const result = await previewCompany(
      { companyNumber: "09668396" },
      deps(async () => ({ record: record(), companyNumber: "09668396" })),
    );

    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.preview.organisation.legal_name, "Sheffield Community Hub CIC");
    assert.equal(result.preview.organisation.organisation_type, "cic");
    assert.equal(result.preview.organisation.city, "Sheffield");
    assert.equal(result.preview.organisation.postcode, "S1 4BT");
    assert.equal(result.preview.companyNumber, "09668396");
    assert.deepEqual(result.preview.identifier, {
      identifierType: "uk_company",
      identifierValue: "09668396",
    });
    assert.equal(result.preview.tier, "B");
    assert.equal(result.preview.sourceConfidence, "strong");
    assert.equal(result.preview.criteria.outcome, "meets");
    assert.equal(result.preview.registration.isActive, true);
    assert.equal(result.preview.registration.status, "active");
    assert.equal(result.preview.registration.incorporatedOn, "2018-05-10");
  });

  it("handles a standard commercial company with weak source confidence", async () => {
    const result = await previewCompany(
      { companyNumber: "12345678" },
      deps(async () => ({
        record: record({
          company_name: "Acme Logistics Ltd",
          company_subtype: undefined,
          sic_codes: ["49410"],
        }),
        companyNumber: "12345678",
      })),
    );

    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.preview.organisation.legal_name, "Acme Logistics Ltd");
    assert.equal(result.preview.organisation.organisation_type, "company");
    assert.equal(result.preview.sourceConfidence, "weak");
    assert.equal(result.preview.criteria.outcome, "needs_review");
  });

  it("flags a company that is dissolved", async () => {
    const result = await previewCompany(
      { companyNumber: "09668396" },
      deps(async () => ({
        record: record({
          company_status: "dissolved",
          date_of_cessation: "2023-01-15",
        }),
        companyNumber: "09668396",
      })),
    );

    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.preview.registration.isActive, false);
    assert.equal(result.preview.registration.status, "dissolved");
    assert.equal(result.preview.registration.dissolvedOn, "2023-01-15");
  });

  it("reports an unknown company number as not found", async () => {
    const result = await previewCompany(
      { companyNumber: "99999999" },
      deps(async () => {
        throw new Error("Companies House could not find that company number.");
      }),
    );
    assert.deepEqual(result, { status: "not_found" });
  });

  it("reports an unknown registered name as not found", async () => {
    const result = await previewCompany(
      { registeredName: "Unknown Nonexistent Org" },
      deps(async () => {
        throw new Error("No exact Companies House match was found for that registered name.");
      }),
    );
    assert.deepEqual(result, { status: "not_found" });
  });

  it("passes through readable adapter messages", async () => {
    const result = await previewCompany(
      { registeredName: "Duplicate Corp" },
      deps(async () => {
        throw new Error("More than one exact Companies House match was found; use a company number.");
      }),
    );
    assert.equal(result.status, "unavailable");
    if (result.status !== "unavailable") return;
    assert.equal(
      result.message,
      "More than one exact Companies House match was found; use a company number.",
    );
  });

  it("hides unexpected upstream errors behind a safe generic message", async () => {
    const result = await previewCompany(
      { companyNumber: "09668396" },
      deps(async () => {
        throw new Error("Companies House API returned 502.");
      }),
    );
    assert.equal(result.status, "unavailable");
    if (result.status !== "unavailable") return;
    assert.match(result.message, /could not be reached/);
    assert.doesNotMatch(result.message, /502/);
  });
});
