import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { charityCommissionAdapter } from "./charity-commission.ts";

const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.CHARITY_COMMISSION_API_KEY = "test-key";
  // Narrow range so tests don't loop through 26 years of chunking.
  process.env.CHARITY_COMMISSION_BACKFILL_START = "2026-07-01";
  process.env.CHARITY_COMMISSION_BACKFILL_END = "2026-07-08";
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.CHARITY_COMMISSION_API_KEY;
  delete process.env.CHARITY_COMMISSION_BACKFILL_START;
  delete process.env.CHARITY_COMMISSION_BACKFILL_END;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const searchResult = {
  organisation_number: 5254841,
  reg_charity_number: 1218781,
  group_subsid_suffix: 0,
  charity_name: "THE NAZE PROTECTION SOCIETY",
  reg_status: "R",
  date_of_registration: "2026-07-07T00:00:00",
  date_of_removal: null,
};

const detailResult = {
  ...searchResult,
  charity_type: "CIO",
  address_line_one: "The Old Rectory",
  address_line_two: "Rectory Road",
  address_line_three: "Great Holland",
  address_line_four: "Frinton-on-Sea",
  address_line_five: null,
  address_post_code: "CO13 0JP",
  phone: "07971648901",
  email: "info@nazeprotectionsociety.org",
  web: "https://nazeprotectionsociety.org",
  reporting_status: "New",
  last_modified_time: "2026-07-13T14:48:43.52",
};

/** Routes a mocked fetch by URL: search calls vs details calls get different responses. */
function routedFetch(opts: {
  onSearch?: (url: string) => Response;
  onDetails?: (url: string) => Response;
}) {
  return mock.fn(async (url: string) => {
    if (url.includes("/searchCharityRegDate/")) {
      return opts.onSearch
        ? opts.onSearch(url)
        : jsonResponse([searchResult]);
    }
    if (url.includes("/charitydetailsmulti/")) {
      return opts.onDetails
        ? opts.onDetails(url)
        : jsonResponse([detailResult]);
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  });
}

describe("charityCommissionAdapter.fetch — successful import", () => {
  it("returns full detail records, not just search-level fields", async () => {
    globalThis.fetch = routedFetch({});

    const { records, truncated } = await charityCommissionAdapter.fetch();

    assert.equal(truncated, false);
    assert.ok(records.length >= 1);
    assert.equal(records[0].source_record_id, "5254841");
    const payload = records[0].raw_payload as typeof detailResult;
    assert.equal(payload.email, "info@nazeprotectionsociety.org");
    assert.equal(payload.phone, "07971648901");
    assert.equal(payload.web, "https://nazeprotectionsociety.org");
    assert.equal(payload.address_post_code, "CO13 0JP");
  });

  it("sends the confirmed auth header on both search and details calls", async () => {
    const seenHeaders: Record<string, string>[] = [];
    globalThis.fetch = mock.fn(async (url: string, init?: RequestInit) => {
      seenHeaders.push(init?.headers as Record<string, string>);
      if (url.includes("/searchCharityRegDate/")) return jsonResponse([searchResult]);
      return jsonResponse([detailResult]);
    });

    await charityCommissionAdapter.fetch();

    for (const headers of seenHeaders) {
      assert.equal(headers["Ocp-Apim-Subscription-Key"], "test-key");
    }
  });

  it("batches reg_charity_numbers into the details call rather than one request per charity", async () => {
    const detailUrls: string[] = [];
    globalThis.fetch = routedFetch({
      onSearch: () =>
        jsonResponse([
          { ...searchResult, reg_charity_number: 1 },
          { ...searchResult, reg_charity_number: 2 },
        ]),
      onDetails: (url) => {
        detailUrls.push(url);
        return jsonResponse([
          { ...detailResult, reg_charity_number: 1, organisation_number: 1 },
          { ...detailResult, reg_charity_number: 2, organisation_number: 2 },
        ]);
      },
    });

    await charityCommissionAdapter.fetch();

    // Both numbers went into ONE details call, not two separate ones.
    assert.equal(detailUrls.length, 1);
    assert.ok(detailUrls[0].includes("1,2") || detailUrls[0].includes("1%2C2"));
  });
});

describe("charityCommissionAdapter.fetch — API failure", () => {
  it("throws when the search step fails persistently", async () => {
    globalThis.fetch = routedFetch({
      onSearch: () => jsonResponse({ error: "down" }, 500),
    });

    await assert.rejects(
      () => charityCommissionAdapter.fetch(),
      /Charity Commission search API returned 500/,
    );
  });

  it("throws when the details step fails persistently", async () => {
    globalThis.fetch = routedFetch({
      onDetails: () => jsonResponse({ error: "down" }, 500),
    });

    await assert.rejects(
      () => charityCommissionAdapter.fetch(),
      /Charity Commission details API returned 500/,
    );
  });

  it("throws when CHARITY_COMMISSION_API_KEY is not set", async () => {
    delete process.env.CHARITY_COMMISSION_API_KEY;

    await assert.rejects(
      () => charityCommissionAdapter.fetch(),
      /CHARITY_COMMISSION_API_KEY is not set/,
    );
  });
});

describe("charityCommissionAdapter.fetch — missing fields / malformed response", () => {
  it("throws a clear error when the search response is not an array", async () => {
    globalThis.fetch = routedFetch({
      onSearch: () => jsonResponse({ unexpected: "envelope" }),
    });

    await assert.rejects(
      () => charityCommissionAdapter.fetch(),
      /Charity Commission search response is not an array/,
    );
  });

  it("throws a clear error when the details response is not an array", async () => {
    globalThis.fetch = routedFetch({
      onDetails: () => jsonResponse({ unexpected: "envelope" }),
    });

    await assert.rejects(
      () => charityCommissionAdapter.fetch(),
      /Charity Commission details response is not an array/,
    );
  });

  it("does not crash on a removed charity with null contact fields", async () => {
    globalThis.fetch = routedFetch({
      onDetails: () =>
        jsonResponse([
          {
            ...detailResult,
            reg_status: "RM",
            phone: null,
            email: null,
            web: null,
            address_line_one: null,
            address_post_code: null,
          },
        ]),
    });

    const { records } = await charityCommissionAdapter.fetch();
    const payload = records[0].raw_payload as typeof detailResult;
    assert.equal(payload.phone, null);
    assert.equal(payload.email, null);
  });
});

describe("charityCommissionAdapter.fetch — source tracking", () => {
  it("reports its own name", () => {
    assert.equal(charityCommissionAdapter.name, "charity_commission");
  });

  it("onError logs without throwing", () => {
    assert.doesNotThrow(() =>
      charityCommissionAdapter.onError(new Error("network down")),
    );
  });
});