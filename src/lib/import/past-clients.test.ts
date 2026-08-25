import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildImportDraft } from "./build-draft.ts";
import { extractOrganisation, isImportUsable } from "./extract-organisation.ts";
import { isPathAllowedByRobots } from "./robots.ts";
import { resolveRegistry } from "./registry-lookup.ts";

/**
 * Real-world test suite covering 180Connect past client websites and import scenarios:
 *
 * 1. Irise International (https://www.irise.org.uk) - Fully confirmed charity (CIO)
 * 2. Sheffield Mind (https://www.sheffieldmind.co.uk) - Dual registered (charity + company)
 * 3. DECSY (https://www.decsy.org.uk) - Partial extraction without register numbers
 * 4. The Link Community (https://www.thelinkcommunity.org) - Fully confirmed charity
 * 5. MS Trust (https://mstrust.org.uk/a-z/ms-therapy-centres) - Deep subpage charity resolution
 * 6. Labre's Hope (https://www.labreshope.co.uk/?srsltid=...) - URL query parameter handling
 * 7. Sustainability Learning CIC (https://www.sustainabilitylearning.co.uk) - CIC / Companies House resolution
 * 8. 7Roadlight (https://www.7roadlight.co.uk) - Insufficient data / JS shell handling
 * 9. Tickets for Good (https://www.ticketsforgood.com/uk) - Page-level extraction with subpath
 * 10. Sheffield Volunteer Centre (https://search.sheffieldvolunteercentre.org.uk/index) - Robots.txt refusal
 * 11. Voluntary Action Sheffield (https://www.vas.org.uk) - Companies House company resolution
 */
describe("Past Clients URL Import Scenarios", () => {
  it("1. Irise International — fully resolves registered charity (11 / 11 fields)", async () => {
    const html = `
      <!doctype html>
      <html><head>
        <title>Irise International | Towards Menstrual Justice</title>
        <meta name="description" content="Towards Global Menstrual Justice. Irise International is a global leader in menstrual justice programming.">
      </head><body>
        <p>Contact: info@irise.org.uk</p>
        <p>Address: 7 Castle Street, Sheffield City Centre, S3 8LT</p>
        <footer>Registered charity in England and Wales no. 1157722</footer>
      </body></html>
    `;

    const extraction = extractOrganisation(html, "https://www.irise.org.uk/");
    assert.equal(extraction.charity?.number, "1157722");
    assert.equal(extraction.contactEmail, "info@irise.org.uk");

    const resolution = await resolveRegistry(extraction, {
      lookupCharity: async () => ({
        charity_name: "IRISE INTERNATIONAL",
        reg_charity_number: 1157722,
        address_line_one: "18 Upperthorpe",
        address_line_two: "SHEFFIELD",
        address_post_code: "S6 3NA",
        email: "info@irise.org.uk",
        web: "www.irise.org.uk",
        charity_co_reg_number: null,
      } as never),
      lookupCompany: async () => { throw new Error("not called"); },
    });

    assert.equal(resolution.matches.length, 1);
    assert.equal(resolution.matches[0].source, "charity_commission");

    const draft = buildImportDraft(extraction, resolution.matches, resolution.notes);
    assert.equal(draft.fields.legal_name, "IRISE INTERNATIONAL");
    assert.equal(draft.fields.organisation_type, "charity");
    assert.equal(draft.fields.address_line_1, "18 Upperthorpe");
    assert.equal(draft.fields.city, "Sheffield");
    assert.equal(draft.fields.postcode, "S6 3NA");
    assert.equal(draft.fields.country_code, "GB");
    assert.equal(draft.fields.website, "https://www.irise.org.uk");
    assert.equal(draft.fields.contact_email, "info@irise.org.uk");
    assert.equal(draft.fields.registry_name, "Charity Commission for England and Wales");
    assert.equal(draft.fields.registry_number, "1157722");
    assert.ok(draft.fields.mission_statement?.includes("Menstrual Justice"));
    assert.equal(draft.importedFieldPaths.length, 11);
  });

  it("2. Sheffield Mind — dual registered as both charity and company (11 / 11 fields)", async () => {
    const html = `
      <!doctype html>
      <html><head>
        <title>Sheffield Mind | Mental Health Charity</title>
        <meta name="description" content="Sheffield Mind provides emotional and practical support to people in Sheffield.">
      </head><body>
        <p>Postcode: S6 2AB</p>
        <footer>Registered Charity No: 276108 | Company Registration No: 01336352</footer>
      </body></html>
    `;

    const extraction = extractOrganisation(html, "https://www.sheffieldmind.co.uk/");
    assert.equal(extraction.charity?.number, "276108");
    assert.equal(extraction.companyNumber, "01336352");

    const resolution = await resolveRegistry(extraction, {
      lookupCharity: async () => ({
        charity_name: "SHEFFIELD MIND LTD",
        reg_charity_number: 276108,
        address_line_one: "The Wellbeing Centre",
        address_line_two: "110 Sharrow Lane",
        address_line_three: "SHEFFIELD",
        address_post_code: "S11 8AL",
        email: "info@sheffieldmind.co.uk",
        web: "www.sheffieldmind.co.uk",
        charity_co_reg_number: "01336352",
      } as never),
      lookupCompany: async () => ({
        company_name: "SHEFFIELD MIND LIMITED",
        company_number: "01336352",
        registered_office_address: {
          address_line_1: "The Wellbeing Centre",
          address_line_2: "110 Sharrow Lane",
          locality: "Sheffield",
          postal_code: "S11 8AL",
          country: "England",
        },
      } as never),
    });

    assert.equal(resolution.matches.length, 2);

    const draft = buildImportDraft(extraction, resolution.matches, resolution.notes);
    // Companies House takes precedence for legal_name
    assert.equal(draft.fields.legal_name, "SHEFFIELD MIND LIMITED");
    assert.equal(draft.fields.organisation_type, "both");
    assert.equal(draft.fields.address_line_1, "The Wellbeing Centre");
    assert.equal(draft.fields.city, "Sheffield");
    assert.equal(draft.fields.postcode, "S11 8AL");
    assert.equal(draft.fields.contact_email, "info@sheffieldmind.co.uk");
    assert.equal(draft.fields.registry_name, "Charity Commission for England and Wales");
    assert.equal(draft.fields.registry_number, "276108");
    assert.equal(draft.importedFieldPaths.length, 11);
    assert.ok(draft.notes.some((n) => n.includes("charitable company")));
  });

  it("3. DECSY — partial extraction without registration numbers (5 fields)", async () => {
    const html = `
      <!doctype html>
      <html><head>
        <title>DECSY - Development Education Centre South Yorkshire</title>
      </head><body>
        <p>Email us at info@decsy.org.uk</p>
        <p>Located in Sheffield S1 4SE</p>
      </body></html>
    `;

    const extraction = extractOrganisation(html, "https://www.decsy.org.uk/");
    assert.equal(extraction.legalName, "DECSY");
    assert.equal(extraction.contactEmail, "info@decsy.org.uk");
    assert.equal(extraction.postcode, "S1 4SE");
    assert.equal(extraction.charity, null);
    assert.equal(extraction.companyNumber, null);

    const resolution = await resolveRegistry(extraction, {
      lookupCharity: async () => { throw new Error("not called"); },
      lookupCompany: async () => { throw new Error("No exact match"); },
    });

    assert.equal(resolution.matches.length, 0);

    const draft = buildImportDraft(extraction, resolution.matches, resolution.notes);
    assert.equal(draft.fields.legal_name, "DECSY");
    assert.equal(draft.fields.contact_email, "info@decsy.org.uk");
    assert.equal(draft.fields.postcode, "S1 4SE");
    assert.equal(draft.fields.country_code, "GB");
    assert.equal(draft.fields.website, "https://www.decsy.org.uk");
    assert.equal(draft.fields.organisation_type, null);
    assert.equal(draft.importedFieldPaths.length, 5);
    assert.ok(draft.notes.some((n) => n.includes("Nothing on this website identified it on a public register")));
  });

  it("4. The Link Community Hub — resolves registered charity (11 / 11 fields)", async () => {
    const html = `
      <!doctype html>
      <html><head>
        <title>The Link Community Hub</title>
        <meta name="description" content="The Link is a locally run community hub offering a range of services.">
      </head><body>
        <footer>Charity Number: 1199450</footer>
      </body></html>
    `;

    const extraction = extractOrganisation(html, "https://www.thelinkcommunity.org/");
    assert.equal(extraction.charity?.number, "1199450");

    const resolution = await resolveRegistry(extraction, {
      lookupCharity: async () => ({
        charity_name: "THE LINK COMMUNITY HUB",
        reg_charity_number: 1199450,
        address_line_one: "83 STRADBROKE DRIVE",
        address_line_two: "SHEFFIELD",
        address_post_code: "S13 8SE",
        email: "heleneadon@thelinkcommunity.org",
        web: "https://www.thelinkcommunity.org/",
      } as never),
      lookupCompany: async () => { throw new Error("not called"); },
    });

    const draft = buildImportDraft(extraction, resolution.matches, resolution.notes);
    assert.equal(draft.fields.legal_name, "THE LINK COMMUNITY HUB");
    assert.equal(draft.fields.organisation_type, "charity");
    assert.equal(draft.fields.address_line_1, "83 STRADBROKE DRIVE");
    assert.equal(draft.fields.city, "Sheffield");
    assert.equal(draft.fields.postcode, "S13 8SE");
    assert.equal(draft.importedFieldPaths.length, 11);
  });

  it("5. MS Trust — subpage URL resolves parent charity (11 / 11 fields)", async () => {
    const html = `
      <!doctype html>
      <html><head>
        <title>MS Therapy Centres | MS Trust</title>
        <meta name="description" content="MS Therapy Centres are local charities that provide non drug therapies.">
      </head><body>
        <p>Email: hello@mstrust.org.uk</p>
        <footer>Registered charity in England and Wales (1088353)</footer>
      </body></html>
    `;

    const extraction = extractOrganisation(html, "https://mstrust.org.uk/a-z/ms-therapy-centres");
    assert.equal(extraction.charity?.number, "1088353");

    const resolution = await resolveRegistry(extraction, {
      lookupCharity: async () => ({
        charity_name: "MULTIPLE SCLEROSIS TRUST",
        reg_charity_number: 1088353,
        address_line_one: "MULTIPLE SCLEROSIS TRUST",
        address_line_two: "SPIRELLA BUILDING",
        address_line_three: "BRIDGE ROAD",
        address_line_four: "LETCHWORTH GARDEN CITY",
        address_post_code: "SG6 4ET",
        email: "info@mstrust.org.uk",
        web: "www.mstrust.org.uk",
      } as never),
      lookupCompany: async () => { throw new Error("not called"); },
    });

    const draft = buildImportDraft(extraction, resolution.matches, resolution.notes);
    assert.equal(draft.fields.legal_name, "MULTIPLE SCLEROSIS TRUST");
    assert.equal(draft.fields.organisation_type, "charity");
    assert.equal(draft.fields.address_line_1, "SPIRELLA BUILDING");
    assert.equal(draft.fields.city, "Letchworth Garden City");
    assert.equal(draft.fields.postcode, "SG6 4ET");
    assert.equal(draft.importedFieldPaths.length, 11);
  });

  it("6. Labre's Hope — handles query parameters and extracts page mission (3 fields)", () => {
    const html = `
      <!doctype html>
      <html><head>
        <title>Labre's Hope - Ending Homelessness</title>
        <meta name="description" content="We strive to end homelessness through employment in ethically made sustainable products.">
      </head><body>
        <h1>Welcome to Labre's Hope</h1>
      </body></html>
    `;

    const extraction = extractOrganisation(
      html,
      "https://www.labreshope.co.uk/?srsltid=AfmBOoo9_4fyVCt6P6R-C94FhoESZ2iasxlzWpbVvSRmEBZ23rv3XVE4",
    );
    assert.equal(extraction.legalName, "Labre's Hope");
    assert.ok(extraction.missionStatement?.includes("end homelessness"));
    assert.equal(extraction.website, "https://www.labreshope.co.uk");
    // No stated country on the page — the .co.uk ccTLD is the evidence.
    assert.equal(extraction.countryCode, "GB");

    const draft = buildImportDraft(extraction, [], []);
    assert.equal(draft.fields.legal_name, "Labre's Hope");
    assert.equal(draft.fields.website, "https://www.labreshope.co.uk");
    assert.ok(draft.fields.mission_statement?.includes("end homelessness"));
    assert.equal(draft.fields.country_code, "GB");
    assert.equal(draft.importedFieldPaths.length, 4);
  });

  it("7. Sustainability Learning CIC — resolves Community Interest Company (10 / 11 fields)", async () => {
    const html = `
      <!doctype html>
      <html><head>
        <title>Sustainability Learning CIC</title>
        <meta name="description" content="Delivering educational sustainability conferences and connecting schools.">
      </head><body>
        <p>Postcode: PR4 0DF</p>
      </body></html>
    `;

    const extraction = extractOrganisation(html, "https://www.sustainabilitylearning.co.uk/");
    assert.equal(extraction.legalName, "Sustainability Learning CIC");

    const resolution = await resolveRegistry(extraction, {
      lookupCharity: async () => { throw new Error("not a charity"); },
      lookupCompany: async () => ({
        company_name: "SUSTAINABILITY LEARNING CIC",
        company_number: "14511193",
        registered_office_address: {
          address_line_1: "1 Lappet Grove",
          locality: "Preston",
          postal_code: "PR4 0DF",
          country: "England",
        },
      } as never),
    });

    assert.equal(resolution.matches.length, 1);
    assert.equal(resolution.matches[0].source, "companies_house");

    const draft = buildImportDraft(extraction, resolution.matches, resolution.notes);
    assert.equal(draft.fields.legal_name, "SUSTAINABILITY LEARNING CIC");
    assert.equal(draft.fields.organisation_type, "company");
    assert.equal(draft.fields.address_line_1, "1 Lappet Grove");
    assert.equal(draft.fields.city, "Preston");
    assert.equal(draft.fields.postcode, "PR4 0DF");
    assert.equal(draft.fields.registry_name, "Companies House");
    assert.equal(draft.fields.registry_number, "14511193");
    assert.equal(draft.importedFieldPaths.length, 10);
  });

  it("8. 7Roadlight — detects empty/JS-only shell as insufficient data", () => {
    const html = `
      <!doctype html>
      <html><head><title></title></head><body><div id="root"></div></body></html>
    `;

    const extraction = extractOrganisation(html, "https://www.7roadlight.co.uk/");
    assert.equal(isImportUsable(extraction), false);

    const draft = buildImportDraft(extraction, [], []);
    assert.equal(draft.fields.legal_name, null);
    assert.equal(draft.fields.website, "https://www.7roadlight.co.uk");
    // Even an empty shell still yields what the domain itself proves.
    assert.equal(draft.fields.country_code, "GB");
    assert.equal(draft.importedFieldPaths.length, 2);
  });

  it("9. Tickets for Good — extracts metadata and Sheffield postcode (5 fields)", () => {
    const html = `
      <!doctype html>
      <html><head>
        <title>Tickets for Good</title>
        <meta name="description" content="Tickets for Good helps key workers access free and discounted tickets.">
      </head><body>
        <p>Sheffield Office: S1 2BX</p>
        <a href="https://www.linkedin.com/company/tickets-for-good/">LinkedIn</a>
      </body></html>
    `;

    const extraction = extractOrganisation(html, "https://www.ticketsforgood.com/uk");
    assert.equal(extraction.legalName, "Tickets for Good");
    assert.equal(extraction.postcode, "S1 2BX");
    assert.equal(extraction.countryCode, "GB");
    assert.ok(extraction.socialLinks.includes("https://www.linkedin.com/company/tickets-for-good/"));

    const draft = buildImportDraft(extraction, [], []);
    assert.equal(draft.fields.legal_name, "Tickets for Good");
    assert.equal(draft.fields.postcode, "S1 2BX");
    assert.equal(draft.importedFieldPaths.length, 5);
  });

  it("10. Sheffield Volunteer Centre — respects robots.txt Disallow on search portal (0 fields)", () => {
    const robotsTxt = `
      User-agent: *
      Disallow: /index
      Disallow: /search
    `;

    const isAllowed = isPathAllowedByRobots(robotsTxt, "/index");
    assert.equal(isAllowed, false, "robots.txt must block access to /index");
  });

  it("11. Voluntary Action Sheffield — resolves active company (10 / 11 fields)", async () => {
    const html = `
      <!doctype html>
      <html><head>
        <title>Voluntary Action Sheffield</title>
      </head><body>
        <p>Contact us: info@vas.org.uk</p>
        <p>Address: The Circle, S1 4FW</p>
      </body></html>
    `;

    const extraction = extractOrganisation(html, "https://www.vas.org.uk/");
    assert.equal(extraction.legalName, "Voluntary Action Sheffield");
    assert.equal(extraction.contactEmail, "info@vas.org.uk");

    const resolution = await resolveRegistry(extraction, {
      lookupCharity: async () => { throw new Error("not a charity"); },
      lookupCompany: async () => ({
        company_name: "VOLUNTARY ACTION SHEFFIELD",
        company_number: "00215695",
        registered_office_address: {
          address_line_1: "The Circle",
          address_line_2: "33 Rockingham Lane",
          locality: "Sheffield",
          postal_code: "S1 4FW",
          country: "England",
        },
      } as never),
    });

    assert.equal(resolution.matches.length, 1);
    assert.equal(resolution.matches[0].registryNumber, "00215695");

    const draft = buildImportDraft(extraction, resolution.matches, resolution.notes);
    assert.equal(draft.fields.legal_name, "VOLUNTARY ACTION SHEFFIELD");
    assert.equal(draft.fields.organisation_type, "company");
    assert.equal(draft.fields.address_line_1, "The Circle");
    assert.equal(draft.fields.city, "Sheffield");
    assert.equal(draft.fields.postcode, "S1 4FW");
    assert.equal(draft.fields.contact_email, "info@vas.org.uk");
    assert.equal(draft.fields.registry_name, "Companies House");
    assert.equal(draft.fields.registry_number, "00215695");
    assert.equal(draft.importedFieldPaths.length, 10);
  });
});
