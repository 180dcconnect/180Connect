import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RawCharityCommissionRecord } from "../standardize/charity-commission.ts";
import type { RawCompaniesHouseRecord } from "../standardize/companies-house.ts";
import { extractOrganisation, type WebsiteExtraction } from "./extract-organisation.ts";
import {
  organisationTypeFrom,
  planRegistryLookups,
  resolveRegistry,
  type CompanyLookup,
  type RegistryDependencies,
} from "./registry-lookup.ts";

const EMPTY = extractOrganisation("<html></html>", "https://example.org");

function extraction(overrides: Partial<WebsiteExtraction>): WebsiteExtraction {
  return { ...EMPTY, ...overrides };
}

const CHARITY_RECORD: RawCharityCommissionRecord = {
  organisation_number: 1,
  reg_charity_number: 1101126,
  charity_name: "Sheffield Wildlife Trust",
  reg_status: "R",
  date_of_registration: "1985-01-01",
  date_of_removal: null,
  address_line_one: "37 Ecclesall Road",
  address_post_code: "S11 8PN",
  email: "info@swt.org.uk",
  web: "www.swt.org.uk",
};

const COMPANY_RECORD: RawCompaniesHouseRecord & { company_number: string } = {
  company_number: "04905082",
  company_name: "SHEFFIELD WILDLIFE TRUST LIMITED",
  registered_office_address: {
    address_line_1: "37 Ecclesall Road",
    locality: "Sheffield",
    postal_code: "S11 8PN",
  },
};

function dependencies(overrides: Partial<RegistryDependencies> = {}): RegistryDependencies {
  return {
    lookupCharity: async () => CHARITY_RECORD,
    lookupCompany: async () => COMPANY_RECORD,
    ...overrides,
  };
}

describe("planRegistryLookups", () => {
  it("asks both registers when the site prints both numbers", () => {
    const plan = planRegistryLookups(extraction({
      charity: { register: "england_and_wales", number: "1101126" },
      companyNumber: "04905082",
    }));

    assert.equal(plan.charityNumber, "1101126");
    assert.deepEqual(plan.company, { companyNumber: "04905082" });
  });

  it("asks Companies House alone for a company with no charity number", () => {
    const plan = planRegistryLookups(extraction({ companyNumber: "09876543" }));
    assert.equal(plan.charityNumber, null);
    assert.deepEqual(plan.company, { companyNumber: "09876543" });
  });

  it("keeps a Scottish number without looking it up anywhere", () => {
    const plan = planRegistryLookups(extraction({
      charity: { register: "scotland", number: "SC012345" },
    }));

    assert.equal(plan.charityNumber, null);
    assert.equal(plan.company, null);
    assert.equal(plan.unsupportedRegister, "scotland");
    assert.equal(plan.unsupportedNumber, "SC012345");
  });

  it("falls back to a name search only when nothing identified the organisation", () => {
    assert.deepEqual(
      planRegistryLookups(extraction({ legalName: "Green Futures CIC" })).company,
      { registeredName: "Green Futures CIC" },
    );
  });

  it("withholds the name search from a site with positive non-UK evidence", () => {
    const plan = planRegistryLookups(extraction({
      legalName: "WakaMate",
      countryCode: "NG",
    }));

    assert.equal(plan.company, null);
    assert.equal(plan.withheldNameSearch, "WakaMate");
  });

  it("still name-searches when no country is known — most UK sites never state one", () => {
    const plan = planRegistryLookups(extraction({ legalName: "Green Futures CIC" }));
    assert.deepEqual(plan.company, { registeredName: "Green Futures CIC" });
    assert.equal(plan.withheldNameSearch, null);
  });

  it("still name-searches a site with positive UK evidence", () => {
    const plan = planRegistryLookups(extraction({
      legalName: "Green Futures CIC",
      countryCode: "GB",
    }));
    assert.deepEqual(plan.company, { registeredName: "Green Futures CIC" });
    assert.equal(plan.withheldNameSearch, null);
  });

  it("does not name-search a charity, whose own register is the better question", () => {
    const plan = planRegistryLookups(extraction({
      legalName: "Sheffield Wildlife Trust",
      charity: { register: "england_and_wales", number: "1101126" },
    }));

    assert.equal(plan.company, null);
  });
});

describe("resolveRegistry", () => {
  it("returns both registrations for a charitable company", async () => {
    const resolution = await resolveRegistry(
      extraction({
        charity: { register: "england_and_wales", number: "1101126" },
        companyNumber: "04905082",
      }),
      dependencies(),
    );

    assert.deepEqual(
      resolution.matches.map((match) => match.source),
      ["charity_commission", "companies_house"],
    );
    assert.equal(resolution.matches[0].registryNumber, "1101126");
    assert.equal(resolution.matches[1].registryNumber, "04905082");
    assert.equal(organisationTypeFrom(resolution.matches), "both");
  });

  it("still asks Companies House when the charity register fails", async () => {
    const asked: CompanyLookup[] = [];
    const resolution = await resolveRegistry(
      extraction({
        charity: { register: "england_and_wales", number: "1101126" },
        companyNumber: "04905082",
      }),
      dependencies({
        lookupCharity: async () => {
          throw new Error("Charity Commission API returned 500");
        },
        lookupCompany: async (lookup) => {
          asked.push(lookup);
          return COMPANY_RECORD;
        },
      }),
    );

    assert.deepEqual(asked, [{ companyNumber: "04905082" }]);
    assert.deepEqual(resolution.matches.map((match) => match.source), ["companies_house"]);
    assert.equal(resolution.notes.length, 1);
    assert.match(resolution.notes[0], /1101126/);
    // The CAM is told the number was not confirmed — not what the API said about it.
    assert.doesNotMatch(resolution.notes[0], /500|API/i);
  });

  it("reports an ambiguous name search as unconfirmed rather than failing the import", async () => {
    const resolution = await resolveRegistry(
      extraction({ legalName: "Green Futures" }),
      dependencies({
        lookupCompany: async () => {
          throw new Error("More than one exact Companies House match was found; use a company number.");
        },
      }),
    );

    assert.deepEqual(resolution.matches, []);
    assert.match(resolution.notes[0], /No single Companies House match/);
    assert.equal(organisationTypeFrom(resolution.matches), null);
  });

  it("explains an unsupported register instead of dropping the number", async () => {
    const resolution = await resolveRegistry(
      extraction({ charity: { register: "northern_ireland", number: "NIC101234" } }),
      dependencies(),
    );

    assert.deepEqual(resolution.matches, []);
    assert.match(resolution.notes[0], /NIC101234/);
  });

  it("tells the CAM why a non-UK site was not checked against the UK registers", async () => {
    const askedCompany: CompanyLookup[] = [];
    const resolution = await resolveRegistry(
      extraction({ legalName: "WakaMate", countryCode: "NG" }),
      dependencies({
        lookupCompany: async (lookup) => {
          askedCompany.push(lookup);
          return COMPANY_RECORD;
        },
      }),
    );

    // No lookup was made, and the silence is explained rather than unremarked.
    assert.deepEqual(askedCompany, []);
    assert.deepEqual(resolution.matches, []);
    assert.match(resolution.notes[0], /outside the United Kingdom \(NG\)/);
  });

  it("records the failure for engineers while the CAM sees only the note", async () => {
    const failures: Record<string, unknown>[] = [];
    await resolveRegistry(
      extraction({ charity: { register: "england_and_wales", number: "1101126" } }),
      dependencies({
        lookupCharity: async () => {
          throw new Error("CHARITY_COMMISSION_API_KEY is not set.");
        },
        onFailure: (_error, context) => {
          failures.push(context);
        },
      }),
    );

    assert.deepEqual(failures, [
      { registry: "charity_commission", registeredNumber: "1101126" },
    ]);
  });
});

describe("organisationTypeFrom", () => {
  it("refuses to guess when nothing was confirmed", () => {
    assert.equal(organisationTypeFrom([]), null);
  });
});
