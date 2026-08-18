import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findImportDuplicateMatch } from "./duplicate-detection.ts";
import { extractOrganisation, isImportUsable } from "./extract-organisation.ts";
import { fetchPage, type PageFetchDependencies, type PageResponse } from "./fetch-page.ts";

function fakeResponse(overrides: Partial<PageResponse> = {}): PageResponse {
  return {
    status: 200,
    location: null,
    contentType: "text/html; charset=utf-8",
    body: "<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>",
    truncated: false,
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<PageFetchDependencies> = {}): PageFetchDependencies {
  return {
    resolve: async () => ["93.184.216.34"],
    request: async () => fakeResponse(),
    ...overrides,
  };
}

describe("F256: Manual URL Import Failure Handling", () => {
  describe("State 1: Unreachable / No Usable Data (AC1)", () => {
    it("returns specific unreachable message when host does not resolve", async () => {
      const result = await fetchPage("https://unreachable-example.org", fakeDeps({
        resolve: async () => [],
      }));

      assert.equal(result.status, "unreachable");
      if (result.status === "unreachable") {
        assert.match(result.message, /could not reach that website/i);
        assert.equal(result.requestedUrl, "https://unreachable-example.org/");
      }
    });

    it("returns not_html when target serves a non-HTML file (PDF/binary)", async () => {
      const result = await fetchPage("https://example.org/annual-report.pdf", fakeDeps({
        request: async () => fakeResponse({
          contentType: "application/pdf",
          body: "%PDF-1.4 ...",
        }),
      }));

      assert.equal(result.status, "not_html");
      if (result.status === "not_html") {
        assert.match(result.message, /file rather than a web page/i);
      }
    });

    it("returns empty when response body has zero text", async () => {
      const result = await fetchPage("https://example.org/blank", fakeDeps({
        request: async () => fakeResponse({ body: "   " }),
      }));

      assert.equal(result.status, "empty");
      if (result.status === "empty") {
        assert.match(result.message, /page was empty/i);
      }
    });

    it("returns invalid_url for local/private IPs without network fetch", async () => {
      const result = await fetchPage("http://127.0.0.1:8000/internal", fakeDeps());
      assert.equal(result.status, "invalid_url");
    });
  });

  describe("State 2: Insufficient Data / Below Minimum Threshold (AC2)", () => {
    it("identifies page with only title as insufficient", () => {
      const html = "<html><head><title>Some Generic Page</title></head><body>Welcome</body></html>";
      const extracted = extractOrganisation(html, "https://example.org");

      assert.equal(isImportUsable(extracted), false);
    });

    it("identifies page with legal name but no registration, postcode, or email as insufficient", () => {
      const html = `
        <html>
          <head><meta property="og:site_name" content="Community Action Hub" /></head>
          <body><p>We do great things.</p></body>
        </html>
      `;
      const extracted = extractOrganisation(html, "https://communityactionhub.org");

      assert.equal(extracted.legalName, "Community Action Hub");
      assert.equal(isImportUsable(extracted), false);
    });

    it("marks page with legal name AND registration number as usable", () => {
      const html = `
        <html>
          <head><title>Hope Foundation</title></head>
          <body>
            <h1>Hope Foundation</h1>
            <footer>Registered charity number 1234567</footer>
          </body>
        </html>
      `;
      const extracted = extractOrganisation(html, "https://hopefoundation.org");

      assert.equal(extracted.legalName, "Hope Foundation");
      assert.equal(extracted.charity?.number, "1234567");
      assert.equal(isImportUsable(extracted), true);
    });

    it("marks page with legal name AND valid postcode as usable", () => {
      const html = `
        <html>
          <head><title>Sheffield Care Group</title></head>
          <body>
            <h1>Sheffield Care Group</h1>
            <p>Our office is at 10 Main Street, Sheffield S1 2AA</p>
          </body>
        </html>
      `;
      const extracted = extractOrganisation(html, "https://sheffieldcare.org");

      assert.equal(extracted.legalName, "Sheffield Care Group");
      assert.equal(extracted.postcode, "S1 2AA");
      assert.equal(isImportUsable(extracted), true);
    });
  });

  describe("State 3: Duplicate / Existing Client Detection (AC3)", () => {
    const existingClients = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        legal_name: "Action for Children",
        postcode: "EC1V 9AB",
        website: "https://www.actionforchildren.org.uk",
        registrationNumbers: ["1097940", "04764232"],
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        legal_name: "St John Ambulance",
        postcode: "EC1M 4DA",
        website: "https://www.sja.org.uk",
        registrationNumbers: ["1077261"],
      },
    ];

    it("detects duplicate by charity registration number", () => {
      const duplicate = findImportDuplicateMatch(
        {
          legalName: "Action for Children UK",
          postcode: "SW1A 1AA",
          website: "https://different-landing-page.org",
          registrationNumbers: ["1097940"],
        },
        existingClients,
      );

      assert.ok(duplicate);
      assert.equal(duplicate.organisationId, "11111111-1111-1111-1111-111111111111");
      assert.equal(duplicate.matchedOn, "registration_number");
    });

    it("detects duplicate by normalised name and postcode", () => {
      const duplicate = findImportDuplicateMatch(
        {
          legalName: "St John Ambulance Limited",
          postcode: "ec1m 4da",
          website: "https://random-other-url.com",
        },
        existingClients,
      );

      assert.ok(duplicate);
      assert.equal(duplicate.organisationId, "22222222-2222-2222-2222-222222222222");
      assert.equal(duplicate.matchedOn, "name_and_postcode");
    });

    it("detects duplicate by website hostname", () => {
      const duplicate = findImportDuplicateMatch(
        {
          legalName: "St John Regional Branch",
          postcode: null,
          website: "https://sja.org.uk/branches/london",
        },
        existingClients,
      );

      assert.ok(duplicate);
      assert.equal(duplicate.organisationId, "22222222-2222-2222-2222-222222222222");
      assert.equal(duplicate.matchedOn, "website");
    });

    it("permits import when candidate does not match any existing client", () => {
      const duplicate = findImportDuplicateMatch(
        {
          legalName: "New Sheffield Eco Charity",
          postcode: "S1 4DP",
          website: "https://sheffieldeco.org",
          registrationNumbers: ["9876543"],
        },
        existingClients,
      );

      assert.equal(duplicate, null);
    });
  });
});
