import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bulkOrganisationType,
  bulkSector,
  standardizeCharityCommissionBulkRecord,
  type RawCharityCommissionBulkRecord,
} from "./charity-commission-bulk.ts";

function record(
  overrides: Partial<RawCharityCommissionBulkRecord["charity"]> = {},
  rest: Partial<RawCharityCommissionBulkRecord> = {},
): RawCharityCommissionBulkRecord {
  return {
    charity: {
      organisation_number: 1,
      registered_charity_number: 1000001,
      charity_name: "SHEFFIELD EXAMPLE TRUST",
      charity_registration_status: "Registered",
      charity_reporting_status: "Submission Received",
      date_of_registration: "1990-01-01T00:00:00",
      charity_contact_address1: "Unit 4",
      charity_contact_address2: "12 High Street",
      charity_contact_address3: null,
      charity_contact_address4: null,
      charity_contact_address5: "SHEFFIELD",
      charity_contact_postcode: "S1 2HE",
      charity_contact_email: "info@example.org",
      charity_contact_web: "example.org",
      charity_company_registration_number: null,
      charity_is_cio: false,
      ...overrides,
    },
    matched_classifications: ["Education/training"],
    matched_areas: ["Sheffield"],
    annual_returns: [],
    ...rest,
  };
}

describe("standardizeCharityCommissionBulkRecord", () => {
  it("maps the extract's own field names onto the standard shape", () => {
    const org = standardizeCharityCommissionBulkRecord(record());

    assert.equal(org.legal_name, "SHEFFIELD EXAMPLE TRUST");
    assert.equal(org.contact_email, "info@example.org");
    assert.equal(org.website, "example.org");
    assert.equal(org.postcode, "S1 2HE");
    assert.equal(org.entry_method, "api");
    assert.equal(org.outreach_status, "not_contacted");
    assert.equal(org.owner_id, null);
  });

  it("reads the first line as the address and the last as the town", () => {
    const org = standardizeCharityCommissionBulkRecord(record());
    // "Unit 4" and not "12 High Street": the unit number is part of the address
    // and the extract already ordered the lines.
    assert.equal(org.address_line_1, "Unit 4");
    assert.equal(org.city, "Sheffield");
  });

  it("handles a single-line address without inventing a town", () => {
    const org = standardizeCharityCommissionBulkRecord(
      record({
        charity_contact_address1: "The Old Vicarage",
        charity_contact_address2: null,
        charity_contact_address5: null,
      }),
    );
    assert.equal(org.address_line_1, "The Old Vicarage");
    assert.equal(org.city, "");
  });

  it("leaves geographic reach unset rather than guessing from the filter", () => {
    assert.equal(standardizeCharityCommissionBulkRecord(record()).geographic_reach, null);
  });

  it("survives a payload with almost nothing in it", () => {
    const org = standardizeCharityCommissionBulkRecord({ charity: {} });
    assert.equal(org.legal_name, "");
    assert.equal(org.organisation_type, "charity");
  });
});

describe("bulkOrganisationType", () => {
  it("recognises a CIO", () => {
    assert.equal(bulkOrganisationType({ charity_is_cio: true }), "cio");
  });

  it("recognises a charitable company as both", () => {
    assert.equal(
      bulkOrganisationType({ charity_company_registration_number: "01234567" }),
      "both",
    );
  });

  it("falls back to charity, not to a guess", () => {
    assert.equal(bulkOrganisationType({}), "charity");
    assert.equal(bulkOrganisationType({ charity_company_registration_number: "  " }), "charity");
  });

  it("prefers CIO over the company number a CIO may also carry", () => {
    assert.equal(
      bulkOrganisationType({ charity_is_cio: true, charity_company_registration_number: "01" }),
      "cio",
    );
  });
});

describe("bulkSector", () => {
  it("maps the regulator's classification onto the taxonomy the scorer reads", () => {
    assert.equal(bulkSector(["Education/training"]), "Education & Training");
    assert.equal(
      bulkSector(["The Advancement Of Health Or Saving Of Lives"]),
      "Health & Social Care",
    );
  });

  it("picks one sector for a charity classified under several", () => {
    // Declaration order in the config decides, so the same charity always lands
    // in the same sector rather than depending on the register's row order.
    const sector = bulkSector(["Education/training", "Disability"]);
    assert.equal(sector, "Disability Support");
  });

  it("returns null rather than a sector the scorer cannot match", () => {
    assert.equal(bulkSector(["Religious Activities"]), null);
    assert.equal(bulkSector([]), null);
    assert.equal(bulkSector(undefined), null);
  });
});
