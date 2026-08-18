import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { standardizeCharityCommissionRecord } from "../standardize/charity-commission.ts";
import { standardizeCompaniesHouseRecord } from "../standardize/companies-house.ts";
import { buildImportDraft, retainedImportedPaths } from "./build-draft.ts";
import { extractOrganisation, type WebsiteExtraction } from "./extract-organisation.ts";
import type { RegistryMatch } from "./registry-lookup.ts";

const EMPTY = extractOrganisation("<html></html>", "https://example.org");

function extraction(overrides: Partial<WebsiteExtraction>): WebsiteExtraction {
  return { ...EMPTY, ...overrides };
}

const CHARITY_MATCH: RegistryMatch = {
  source: "charity_commission",
  registryName: "Charity Commission for England and Wales",
  registryNumber: "1101126",
  organisation: standardizeCharityCommissionRecord({
    organisation_number: 1,
    reg_charity_number: 1101126,
    charity_name: "Sheffield Wildlife Trust",
    reg_status: "R",
    date_of_registration: "1985-01-01",
    date_of_removal: null,
    address_line_one: "37 Ecclesall Road",
    address_post_code: "S11 8PN",
    email: "INFO@swt.org.uk",
    web: "www.swt.org.uk",
  }),
  rawPayload: {},
};

const COMPANY_MATCH: RegistryMatch = {
  source: "companies_house",
  registryName: "Companies House",
  registryNumber: "04905082",
  organisation: standardizeCompaniesHouseRecord({
    company_name: "SHEFFIELD WILDLIFE TRUST LIMITED",
    registered_office_address: {
      address_line_1: "37 Ecclesall Road",
      locality: "Sheffield",
      postal_code: "S11 8PN",
    },
  }),
  rawPayload: {},
};

describe("buildImportDraft", () => {
  it("takes the legal identity from the register and the mission from the website", () => {
    const draft = buildImportDraft(
      extraction({
        legalName: "Sheffield Wildlife Trust (SWT)",
        missionStatement: "We protect wild places.",
        website: "https://www.swt.org.uk",
      }),
      [CHARITY_MATCH, COMPANY_MATCH],
    );

    assert.equal(draft.fields.legal_name, "SHEFFIELD WILDLIFE TRUST LIMITED");
    assert.equal(draft.fields.mission_statement, "We protect wild places.");
    assert.equal(draft.fields.city, "Sheffield");
    assert.equal(draft.fields.postcode, "S11 8PN");
  });

  it("keeps the website the CAM proved resolves, not the register's stale copy", () => {
    const draft = buildImportDraft(
      extraction({ website: "https://www.swt.org.uk" }),
      [CHARITY_MATCH],
    );

    assert.equal(draft.fields.website, "https://www.swt.org.uk");
  });

  it("takes the contact inbox from the charity register, normalised", () => {
    const draft = buildImportDraft(
      extraction({ contactEmail: "webform@swt.org.uk" }),
      [CHARITY_MATCH],
    );

    assert.equal(draft.fields.contact_email, "info@swt.org.uk");
  });

  it("records the charity registration for a charitable company and notes the company number", () => {
    const draft = buildImportDraft(extraction({}), [CHARITY_MATCH, COMPANY_MATCH]);

    assert.equal(draft.fields.organisation_type, "both");
    assert.equal(draft.fields.registry_name, "Charity Commission for England and Wales");
    assert.equal(draft.fields.registry_number, "1101126");
    assert.ok(draft.notes.some((note) => note.includes("04905082")));
  });

  it("types a company-only match as a company", () => {
    const draft = buildImportDraft(extraction({}), [COMPANY_MATCH]);

    assert.equal(draft.fields.organisation_type, "company");
    assert.equal(draft.fields.registry_name, "Companies House");
    assert.equal(draft.fields.registry_number, "04905082");
  });

  it("leaves the type blank and says so when no register confirmed anything", () => {
    const draft = buildImportDraft(
      extraction({ legalName: "Some Group", postcode: "S1 1AA" }),
      [],
    );

    assert.equal(draft.fields.organisation_type, null);
    assert.equal(draft.fields.registry_number, null);
    assert.ok(draft.notes.some((note) => note.includes("unverified")));
  });

  it("marks exactly the fields it filled as imported", () => {
    const draft = buildImportDraft(
      // As extractOrganisation would return it: a UK postcode implies the country.
      extraction({
        legalName: "Some Group",
        postcode: "s1 1aa",
        countryCode: "GB",
        website: "https://x.org",
      }),
      [],
    );

    assert.deepEqual(
      [...draft.importedFieldPaths].sort(),
      ["country_code", "legal_name", "postcode", "website"],
    );
    assert.equal(draft.fields.postcode, "S1 1AA");
  });

  it("carries the registry notes through to the CAM", () => {
    const draft = buildImportDraft(extraction({}), [], ["The charity number could not be confirmed."]);
    assert.ok(draft.notes.includes("The charity number could not be confirmed."));
  });
});

describe("retainedImportedPaths", () => {
  const original = { legal_name: "Imported Name", city: "Sheffield" };

  it("drops a field the CAM has retyped", () => {
    assert.deepEqual(
      retainedImportedPaths(["legal_name", "city"], original, {
        legal_name: "Corrected Name",
        city: "Sheffield",
      }),
      ["city"],
    );
  });

  it("keeps a field the CAM only reformatted whitespace on", () => {
    assert.deepEqual(
      retainedImportedPaths(["city"], original, { city: "  Sheffield  " }),
      ["city"],
    );
  });

  it("drops a field the CAM cleared", () => {
    assert.deepEqual(retainedImportedPaths(["city"], original, { city: "" }), []);
  });
});
