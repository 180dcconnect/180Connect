import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countryFromHost,
  extractOrganisation,
  findCharityNumber,
  findCompanyNumber,
  isImportUsable,
  nameFromTitle,
  normaliseCountry,
  visibleText,
} from "./extract-organisation.ts";

const JSON_LD_PAGE = `
<!doctype html>
<html><head>
  <title>Home | Sheffield Wildlife Trust</title>
  <meta property="og:site_name" content="Sheffield Wildlife Trust">
  <meta name="description" content="Protecting wild places across South Yorkshire.">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "name": "swt.org.uk" },
      {
        "@type": "NGO",
        "name": "Sheffield Wildlife Trust",
        "description": "We protect and restore wild places across South Yorkshire.",
        "email": "info@swt.org.uk",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "37 Ecclesall Road",
          "addressLocality": "Sheffield",
          "postalCode": "s11 8pn",
          "addressCountry": "United Kingdom"
        },
        "sameAs": ["https://twitter.com/swt", "https://www.linkedin.com/company/swt"]
      }
    ]
  }
  </script>
</head><body>
  <footer>Registered charity number 1101126. Company number 04905082.</footer>
</body></html>`;

describe("extractOrganisation", () => {
  it("prefers the site's own structured data over its metadata and title", () => {
    const extracted = extractOrganisation(JSON_LD_PAGE, "https://www.swt.org.uk/");

    assert.equal(extracted.legalName, "Sheffield Wildlife Trust");
    assert.equal(
      extracted.missionStatement,
      "We protect and restore wild places across South Yorkshire.",
    );
    assert.equal(extracted.contactEmail, "info@swt.org.uk");
    assert.equal(extracted.addressLine1, "37 Ecclesall Road");
    assert.equal(extracted.city, "Sheffield");
    assert.equal(extracted.postcode, "S11 8PN");
    assert.equal(extracted.countryCode, "GB");
    assert.equal(extracted.website, "https://www.swt.org.uk");
  });

  it("reads both registrations out of the footer", () => {
    const extracted = extractOrganisation(JSON_LD_PAGE, "https://www.swt.org.uk/");

    assert.deepEqual(extracted.charity, { register: "england_and_wales", number: "1101126" });
    assert.equal(extracted.companyNumber, "04905082");
  });

  it("infers the country from the ccTLD when a non-UK site states none (wakamate.ng)", () => {
    // The shape of a real Nigerian business site: title, meta description and a
    // contact email, no JSON-LD, no stated address anywhere.
    const html = `
      <!doctype html>
      <html><head>
        <title>WakaMate - Book Trusted Artisans On Demand</title>
        <meta name="description" content="Connecting you with vetted professionals for all your home and office needs.">
      </head><body>
        <a href="mailto:hello@wakamate.ng">hello@wakamate.ng</a>
      </body></html>
    `;

    const extracted = extractOrganisation(html, "https://wakamate.ng/");
    assert.equal(extracted.legalName, "WakaMate");
    assert.ok(extracted.missionStatement?.includes("vetted professionals"));
    assert.equal(extracted.contactEmail, "hello@wakamate.ng");
    assert.equal(extracted.countryCode, "NG");
  });

  it("prefers a stated country over the ccTLD when they could differ", () => {
    const html = `<html><head><title>A Charity</title></head><body></body></html>`;
    // A .com site that states its country in structured data.
    const withAddress = `
      <html><head><title>A Charity</title>
        <script type="application/ld+json">{"@type":"NGO","name":"A Charity",
          "address":{"@type":"PostalAddress","addressCountry":"Kenya"}}</script>
      </head><body></body></html>
    `;

    assert.equal(extractOrganisation(html, "https://acharity.com").countryCode, null);
    assert.equal(extractOrganisation(withAddress, "https://acharity.com").countryCode, "KE");
  });

  it("collects one link per social platform, ignoring bare homepages", () => {
    const html = `<html><body>
      <a href="https://facebook.com">Facebook</a>
      <a href="https://www.facebook.com/sheffieldtrust">Us on Facebook</a>
      <a href="https://www.facebook.com/sheffieldtrust/photos">Photos</a>
      <a href="https://example.org/about">About</a>
    </body></html>`;

    assert.deepEqual(
      extractOrganisation(html, "https://example.org").socialLinks,
      ["https://www.facebook.com/sheffieldtrust"],
    );
  });

  it("falls back to metadata and the title when there is no structured data", () => {
    const html = `<html><head>
      <title>Green Futures CIC — Home</title>
      <meta name="description" content="Community energy in Rotherham.">
    </head><body>
      <p>Contact us at hello@greenfutures.org.uk</p>
      <p>Company number 09876543</p>
    </body></html>`;

    const extracted = extractOrganisation(html, "https://greenfutures.org.uk/about");

    assert.equal(extracted.legalName, "Green Futures CIC");
    assert.equal(extracted.missionStatement, "Community energy in Rotherham.");
    assert.equal(extracted.contactEmail, "hello@greenfutures.org.uk");
    assert.equal(extracted.companyNumber, "09876543");
    // The origin, not the page the CAM happened to paste.
    assert.equal(extracted.website, "https://greenfutures.org.uk");
  });

  it("survives structured data that is not valid JSON", () => {
    const html = `<html><head>
      <title>Broken Charity</title>
      <script type="application/ld+json">{ "@type": "NGO", oops }</script>
      <meta name="description" content="Still useful.">
    </head><body><p>Registered charity 1101126</p></body></html>`;

    const extracted = extractOrganisation(html, "https://broken.org");
    assert.equal(extracted.legalName, "Broken Charity");
    assert.equal(extracted.missionStatement, "Still useful.");
    assert.deepEqual(extracted.charity, { register: "england_and_wales", number: "1101126" });
  });

  it("returns everything empty for an empty page rather than throwing", () => {
    const extracted = extractOrganisation("   ", "https://example.org");
    assert.equal(extracted.legalName, null);
    assert.equal(extracted.charity, null);
    assert.deepEqual(extracted.socialLinks, []);
  });

  it("does not read script or style contents as body text", () => {
    const html = `<html><body>
      <script>var registeredCharityNumber = "1234567";</script>
      <style>.x { content: "charity number 7654321"; }</style>
      <p>Nothing here.</p>
    </body></html>`;

    assert.equal(extractOrganisation(html, "https://example.org").charity, null);
    assert.equal(visibleText(html), "Nothing here.");
  });

  it("prefers a role inbox over a named person's address", () => {
    const html = `<html><body>
      <p>Reach Sarah at sarah.hughes@example.org or the team at info@example.org</p>
    </body></html>`;

    assert.equal(
      extractOrganisation(html, "https://example.org").contactEmail,
      "info@example.org",
    );
  });

  it("keeps a description that contains an apostrophe", () => {
    // mind.org.uk's real og:description. Matching the closing quote loosely ends the
    // value at the apostrophe and imports the mission as "We".
    const html = `<html><head><meta property="og:description" content="We're Mind, the mental health charity."></head></html>`;

    assert.equal(
      extractOrganisation(html, "https://mind.org.uk").missionStatement,
      "We're Mind, the mental health charity.",
    );
  });

  it("keeps only the town when a site puts the country in the locality", () => {
    // The British Heart Foundation publishes addressLocality as "London, United Kingdom".
    const html = `<html><head><script type="application/ld+json">
      {"@type":"NGO","name":"BHF","address":{"addressLocality":"London, United Kingdom"}}
    </script></head></html>`;

    assert.equal(extractOrganisation(html, "https://bhf.org.uk").city, "London");
  });

  it("decodes entities in the values it returns", () => {
    const html = `<html><head><title>Barnsley &amp; Rotherham Trust</title>
      <meta name="description" content="Support for carers &ndash; every day."></head></html>`;

    const extracted = extractOrganisation(html, "https://example.org");
    assert.equal(extracted.legalName, "Barnsley & Rotherham Trust");
    assert.equal(extracted.missionStatement, "Support for carers – every day.");
  });
});

describe("findCharityNumber", () => {
  it("reads an England and Wales number from the wording around it", () => {
    for (const text of [
      "Registered charity number 1101126",
      "Registered charity no. 1101126",
      "Charity registration number: 1101126",
      "charity #1101126",
      "1101126 is our registered charity number",
    ]) {
      assert.deepEqual(
        findCharityNumber(text),
        { register: "england_and_wales", number: "1101126" },
        text,
      );
    }
  });

  it("ignores bare seven-digit runs with nothing to say what they are", () => {
    assert.equal(findCharityNumber("We raised 1250000 last year. Call 0114 2734567."), null);
  });

  it("takes the England and Wales number when a charity lists several nations", () => {
    // British Heart Foundation's real footer. A prefix-first search finds SC039426,
    // which is on a register 180Connect cannot query, and misses the one it can.
    assert.deepEqual(
      findCharityNumber(
        "The British Heart Foundation is a registered charity in England and Wales (225971), Scotland (SC039426) and the Isle of Man (1295).",
      ),
      { register: "england_and_wales", number: "225971" },
    );
  });

  it("separates the Scottish and Northern Irish registers, padding the number", () => {
    assert.deepEqual(
      findCharityNumber("Scottish charity SC012345"),
      { register: "scotland", number: "SC012345" },
    );
    assert.deepEqual(
      findCharityNumber("Registered with the Charity Commission NI, NIC101234"),
      { register: "northern_ireland", number: "NIC101234" },
    );
  });
});

describe("findCompanyNumber", () => {
  it("reads a stated company number in the forms sites print", () => {
    assert.equal(findCompanyNumber("Company number 04905082"), "04905082");
    assert.equal(findCompanyNumber("Company no. SC123456"), "SC123456");
    assert.equal(findCompanyNumber("Companies House registration number: 04905082"), "04905082");
  });

  it("reads the 'registered in England' form", () => {
    assert.equal(
      findCompanyNumber("A company registered in England and Wales, number 04905082."),
      "04905082",
    );
  });

  it("pads a short number to the eight characters Companies House stores", () => {
    assert.equal(findCompanyNumber("Company number 12345"), "00012345");
  });

  it("returns null when no company registration is stated", () => {
    assert.equal(findCompanyNumber("Call us on 0114 273 4567"), null);
  });
});

describe("nameFromTitle", () => {
  it("keeps the organisation and drops the page", () => {
    assert.equal(nameFromTitle("Sheffield Wildlife Trust | Home"), "Sheffield Wildlife Trust");
    assert.equal(nameFromTitle("Home | Sheffield Wildlife Trust"), "Sheffield Wildlife Trust");
    assert.equal(nameFromTitle("About Us — Green Futures CIC"), "Green Futures CIC");
  });

  it("returns a plain title unchanged", () => {
    assert.equal(nameFromTitle("Green Futures CIC"), "Green Futures CIC");
  });
});

describe("normaliseCountry", () => {
  it("maps the ways a UK site writes its country onto GB", () => {
    for (const value of ["United Kingdom", "uk", "England", "Scotland", "GB"]) {
      assert.equal(normaliseCountry(value), "GB", value);
    }
  });

  it("maps full country names from the CLDR, not just the UK's neighbours", () => {
    assert.equal(normaliseCountry("Nigeria"), "NG");
    assert.equal(normaliseCountry("Germany"), "DE");
    assert.equal(normaliseCountry("Kenya"), "KE");
    assert.equal(normaliseCountry("South Korea"), "KR");
  });

  it("matches accented and punctuated names case-insensitively", () => {
    assert.equal(normaliseCountry("Côte d'Ivoire"), "CI");
    assert.equal(normaliseCountry("côte d’ivoire"), "CI");
    assert.equal(normaliseCountry("IVORY COAST"), "CI");
  });

  it("keeps the well-known aliases CLDR does not use", () => {
    assert.equal(normaliseCountry("Holland"), "NL");
    assert.equal(normaliseCountry("Czech Republic"), "CZ");
  });

  it("returns null rather than guessing at something unrecognised", () => {
    assert.equal(normaliseCountry("Planet Earth"), null);
    assert.equal(normaliseCountry(null), null);
  });
});

describe("countryFromHost", () => {
  it("reads the ccTLD as the country", () => {
    assert.equal(countryFromHost("https://wakamate.ng/"), "NG");
    assert.equal(countryFromHost("https://example.co.za/about"), "ZA");
    // Second-level suffixes resolve to their registry's ccTLD.
    assert.equal(countryFromHost("https://www.example.com.ng"), "NG");
    // .uk is not its own ISO code.
    assert.equal(countryFromHost("https://www.example.co.uk/x"), "GB");
  });

  it("returns null for generic TLDs, which name no country", () => {
    assert.equal(countryFromHost("https://www.ticketsforgood.com/uk"), null);
    assert.equal(countryFromHost("https://hopefoundation.org"), null);
    assert.equal(countryFromHost("not a url"), null);
  });
});

describe("isImportUsable", () => {
  const base = extractOrganisation("<html></html>", "https://example.org");

  it("rejects an import that found nothing but a name", () => {
    assert.equal(isImportUsable({ ...base, legalName: "A Charity" }), false);
  });

  it("rejects an import with identifiers but no name", () => {
    assert.equal(isImportUsable({ ...base, companyNumber: "04905082" }), false);
  });

  it("accepts a name with anything that identifies which organisation it is", () => {
    assert.equal(isImportUsable({ ...base, legalName: "A", postcode: "S1 1AA" }), true);
    assert.equal(isImportUsable({ ...base, legalName: "A", contactEmail: "i@a.org" }), true);
    assert.equal(isImportUsable({ ...base, legalName: "A", companyNumber: "04905082" }), true);
  });
});
