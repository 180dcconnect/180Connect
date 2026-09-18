import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  charityRegisterHref,
  companiesHouseHref,
  organisationSourceLinks,
  websiteHref,
} from "./organisation-source-links.ts";

describe("charityRegisterHref", () => {
  it("links a charity number to its register page", () => {
    assert.equal(
      charityRegisterHref("1234567"),
      "https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/1234567",
    );
  });

  it("strips the punctuation numbers arrive with", () => {
    assert.equal(
      charityRegisterHref(" 123 45-67 "),
      "https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/1234567",
    );
  });

  it("offers no link when there is no number", () => {
    assert.equal(charityRegisterHref(null), null);
    assert.equal(charityRegisterHref(undefined), null);
    assert.equal(charityRegisterHref("   "), null);
  });
});

describe("companiesHouseHref", () => {
  it("links a company number to its Companies House page", () => {
    assert.equal(
      companiesHouseHref("09876543"),
      "https://find-and-update.company-information.service.gov.uk/company/09876543",
    );
  });

  it("keeps the alphanumeric form company numbers can take", () => {
    assert.equal(
      companiesHouseHref("SC123456"),
      "https://find-and-update.company-information.service.gov.uk/company/SC123456",
    );
  });

  it("offers no link when there is no number", () => {
    assert.equal(companiesHouseHref(null), null);
    assert.equal(companiesHouseHref("  "), null);
  });
});

describe("websiteHref", () => {
  it("leaves a full URL alone", () => {
    assert.equal(websiteHref("https://example.org"), "https://example.org");
    assert.equal(websiteHref("http://example.org"), "http://example.org");
  });

  it("gives a bare domain a scheme, so the link goes somewhere", () => {
    assert.equal(websiteHref("example.org"), "https://example.org");
    assert.equal(websiteHref("  example.org  "), "https://example.org");
    assert.equal(websiteHref("HTTP://example.org"), "HTTP://example.org");
  });

  it("offers no link when there is no website", () => {
    assert.equal(websiteHref(null), null);
    assert.equal(websiteHref("   "), null);
  });
});

describe("organisationSourceLinks", () => {
  it("reads registers first, then the organisation's own site", () => {
    assert.deepEqual(
      organisationSourceLinks({
        charityNumber: "1234567",
        companyNumber: "09876543",
        website: "example.org",
      }),
      [
        {
          href: "https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/1234567",
          label: "Charity Commission register",
        },
        {
          href: "https://find-and-update.company-information.service.gov.uk/company/09876543",
          label: "Companies House",
        },
        { href: "https://example.org", label: "Website" },
      ],
    );
  });

  it("offers only the sources the record actually has", () => {
    assert.deepEqual(organisationSourceLinks({ charityNumber: "1234567" }), [
      {
        href: "https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/1234567",
        label: "Charity Commission register",
      },
    ]);
    assert.deepEqual(organisationSourceLinks({ website: "example.org" }), [
      { href: "https://example.org", label: "Website" },
    ]);
  });

  it("offers nothing at all for an empty record", () => {
    assert.deepEqual(organisationSourceLinks({}), []);
    assert.deepEqual(
      organisationSourceLinks({ charityNumber: null, companyNumber: null, website: null }),
      [],
    );
  });
});
