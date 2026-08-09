import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createCompaniesHouseAdapter,
  createCompaniesHouseBulkSearchAdapter,
  normalizeRegisteredName,
} from "./companieshouse.ts";

const originalFetch = globalThis.fetch;
const originalKey = process.env.COMPANIES_HOUSE_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
  else process.env.COMPANIES_HOUSE_API_KEY = originalKey;
});

function enableTestKey() {
  process.env.COMPANIES_HOUSE_API_KEY = "test-key";
}

describe("normalizeRegisteredName", () => {
  it("ignores case, punctuation and spacing", () => {
    assert.equal(
      normalizeRegisteredName(" Example-Charity (UK) Ltd. "),
      normalizeRegisteredName("EXAMPLE CHARITY UK LTD"),
    );
  });
});

describe("createCompaniesHouseAdapter", () => {
  it("uses a known company number to fetch and shape the full profile", async () => {
    enableTestKey();
    let requestedUrl = "";
    let authorization = "";
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({
        company_number: "01234567",
        company_name: "Example Charity Ltd",
        registered_office_address: { postal_code: "SW1A 1AA" },
      });
    };

    const result = await createCompaniesHouseAdapter({
      companyNumber: " 01234567 ",
    }).fetch();

    assert.equal(requestedUrl.endsWith("/company/01234567"), true);
    assert.equal(result.records[0].source_record_id, "01234567");
    assert.equal(result.records[0].source_country, "GB");
    assert.equal(result.records[0].source_registry_name, "Companies House");
    assert.equal(
      authorization,
      `Basic ${Buffer.from("test-key:").toString("base64")}`,
    );
  });

  it("falls back from registered name to one normalized exact match", async () => {
    enableTestKey();
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/search/companies")) {
        return Response.json({
          total_results: 2,
          items: [
            { company_number: "11111111", title: "Example Charity Limited" },
            { company_number: "22222222", title: "Example Charity (UK) Ltd." },
          ],
        });
      }
      return Response.json({
        company_number: "22222222",
        company_name: "Example Charity (UK) Ltd.",
      });
    };

    const result = await createCompaniesHouseAdapter({
      registeredName: "example charity uk ltd",
    }).fetch();

    assert.match(urls[0], /search\/companies\?q=example%20charity%20uk%20ltd/);
    assert.equal(urls[1].endsWith("/company/22222222"), true);
    assert.equal(result.records[0].source_record_id, "22222222");
  });

  it("refuses a name search with no exact match", async () => {
    enableTestKey();
    globalThis.fetch = async () => Response.json({
      total_results: 1,
      items: [{ company_number: "11111111", title: "Different Organisation" }],
    });

    await assert.rejects(
      () => createCompaniesHouseAdapter({ registeredName: "Example Charity" }).fetch(),
      /No exact Companies House match/,
    );
  });

  it("refuses an ambiguous exact-name match", async () => {
    enableTestKey();
    globalThis.fetch = async () => Response.json({
      total_results: 2,
      items: [
        { company_number: "11111111", title: "Example Charity" },
        { company_number: "22222222", title: "EXAMPLE-CHARITY" },
      ],
    });

    await assert.rejects(
      () => createCompaniesHouseAdapter({ registeredName: "Example Charity" }).fetch(),
      /More than one exact Companies House match/,
    );
  });

  it("reports a missing company number in a malformed profile", async () => {
    enableTestKey();
    globalThis.fetch = async () => Response.json({ company_name: "Example Charity" });

    await assert.rejects(
      () => createCompaniesHouseAdapter({ companyNumber: "01234567" }).fetch(),
      /profile is missing its company number/,
    );
  });

  it("reports a missing items array in a malformed search response", async () => {
    enableTestKey();
    globalThis.fetch = async () => Response.json({ total_results: 1 });

    await assert.rejects(
      () => createCompaniesHouseAdapter({ registeredName: "Example Charity" }).fetch(),
      /missing an items array/,
    );
  });

  it("reports a missing company number as a clear not-found result", async () => {
    enableTestKey();
    globalThis.fetch = async () => new Response(null, { status: 404 });

    await assert.rejects(
      () => createCompaniesHouseAdapter({ companyNumber: "01234567" }).fetch(),
      /could not find that company number/,
    );
  });

  it("retries an unavailable API and never exposes the key", async () => {
    process.env.COMPANIES_HOUSE_API_KEY = "do-not-leak";
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(null, {
        status: 503,
        headers: { "retry-after": "0" },
      });
    };

    await assert.rejects(
      () => createCompaniesHouseAdapter({ companyNumber: "01234567" }).fetch(),
      (error: Error) => {
        assert.match(error.message, /returned 503/);
        assert.doesNotMatch(error.message, /do-not-leak/);
        return true;
      },
    );
    assert.equal(calls, 3);
  });
});

describe("createCompaniesHouseBulkSearchAdapter", () => {
  it("shapes search items directly, without fetching a per-company profile", async () => {
    enableTestKey();
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return Response.json({
        hits: 1,
        items: [
          {
            company_number: "13273297",
            company_name: "Witsmate Limited",
            registered_office_address: { postal_code: "WA14 4RW" },
          },
        ],
      });
    };

    const result = await createCompaniesHouseBulkSearchAdapter({
      sicCodes: ["62012"],
      location: "Manchester",
    }).fetch();

    assert.equal(urls.length, 1);
    assert.match(urls[0], /\/advanced-search\/companies\?/);
    assert.match(urls[0], /sic_codes=62012/);
    assert.match(urls[0], /location=Manchester/);
    assert.match(urls[0], /company_status=active/);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].source_record_id, "13273297");
    assert.equal(result.truncated, false);
  });

  it("defaults company_status to active and honours an explicit override", async () => {
    enableTestKey();
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return Response.json({ hits: 0, items: [] });
    };

    await createCompaniesHouseBulkSearchAdapter({
      location: "Leeds",
      companyStatus: "dissolved",
    }).fetch();

    assert.match(requestedUrl, /company_status=dissolved/);
  });

  it("pages through start_index until an empty page is returned", async () => {
    enableTestKey();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) {
        return Response.json({
          hits: 150,
          items: Array.from({ length: 100 }, (_, i) => ({
            company_number: `${1000 + i}`,
            company_name: `Company ${i}`,
          })),
        });
      }
      if (calls === 2) {
        return Response.json({
          hits: 150,
          items: Array.from({ length: 50 }, (_, i) => ({
            company_number: `${2000 + i}`,
            company_name: `Company ${i}`,
          })),
        });
      }
      return Response.json({ hits: 150, items: [] });
    };

    const result = await createCompaniesHouseBulkSearchAdapter({
      sicCodes: ["62012"],
    }).fetch();

    assert.equal(calls, 2);
    assert.equal(result.records.length, 150);
    assert.equal(result.truncated, false);
  });

  it("rejects a search item with no company number", async () => {
    enableTestKey();
    globalThis.fetch = async () => Response.json({
      hits: 1,
      items: [{ company_name: "No Number Ltd" }],
    });

    await assert.rejects(
      () => createCompaniesHouseBulkSearchAdapter({ location: "Leeds" }).fetch(),
      /missing a company number/,
    );
  });
});
