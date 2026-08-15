import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  charityCommissionAdapter,
  createCharityCommissionLookupAdapter,
  createCharityCommissionDiscoveryAdapter,
  createCharityCommissionStatusRecheckAdapter,
} from "./charity-commission.ts";

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
  return mock.fn(async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes("/searchCharityRegDate/")) {
      return opts.onSearch
        ? opts.onSearch(urlStr)
        : jsonResponse([searchResult]);
    }
    if (urlStr.includes("/charitydetailsmulti/")) {
      return opts.onDetails
        ? opts.onDetails(urlStr)
        : jsonResponse([detailResult]);
    }
    throw new Error(`Unexpected URL in test: ${urlStr}`);
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
    globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenHeaders.push(init?.headers as Record<string, string>);
      if (String(url).includes("/searchCharityRegDate/")) return jsonResponse([searchResult]);
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

describe("createCharityCommissionLookupAdapter.fetch — successful lookup", () => {
  it("fetches exactly one charity by registration number", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      requestedUrls.push(String(url));
      return jsonResponse([detailResult]);
    });

    const { records, truncated } = await createCharityCommissionLookupAdapter({
      registeredNumber: "1218781",
    }).fetch();

    assert.equal(truncated, false);
    assert.equal(records.length, 1);
    assert.equal(records[0].source_record_id, "5254841");
    assert.equal(requestedUrls.length, 1);
    assert.ok(requestedUrls[0].includes("/charitydetailsmulti/1218781"));
  });

  it("trims whitespace around the registration number", async () => {
    let requestedUrl = "";
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return jsonResponse([detailResult]);
    });

    await createCharityCommissionLookupAdapter({
      registeredNumber: "  1218781  ",
    }).fetch();

    assert.ok(requestedUrl.includes("/charitydetailsmulti/1218781"));
  });
});

describe("createCharityCommissionLookupAdapter.fetch — invalid input", () => {
  it("rejects a non-numeric registration number without calling the API", async () => {
    let called = false;
    globalThis.fetch = mock.fn(async () => {
      called = true;
      return jsonResponse([detailResult]);
    });

    await assert.rejects(
      () =>
        createCharityCommissionLookupAdapter({
          registeredNumber: "not-a-number",
        }).fetch(),
      /Enter a valid Charity Commission registration number/,
    );
    assert.equal(called, false);
  });

  it("rejects an empty registration number without calling the API", async () => {
    let called = false;
    globalThis.fetch = mock.fn(async () => {
      called = true;
      return jsonResponse([detailResult]);
    });

    await assert.rejects(
      () => createCharityCommissionLookupAdapter({ registeredNumber: "   " }).fetch(),
      /Enter a valid Charity Commission registration number/,
    );
    assert.equal(called, false);
  });
});

describe("createCharityCommissionLookupAdapter.fetch — not found / API failure", () => {
  it("gives a clear message when the API returns an error for an unknown number", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ error: "down" }, 500));

    await assert.rejects(
      () =>
        createCharityCommissionLookupAdapter({
          registeredNumber: "99999999999",
        }).fetch(),
      /Charity Commission could not find a charity with that registration number/,
    );
  });

  it("gives the same clear message when the response is empty rather than an error", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse([]));

    await assert.rejects(
      () =>
        createCharityCommissionLookupAdapter({ registeredNumber: "1218781" }).fetch(),
      /Charity Commission could not find a charity with that registration number/,
    );
  });

  it("throws when CHARITY_COMMISSION_API_KEY is not set", async () => {
    delete process.env.CHARITY_COMMISSION_API_KEY;

    await assert.rejects(
      () =>
        createCharityCommissionLookupAdapter({ registeredNumber: "1218781" }).fetch(),
      /CHARITY_COMMISSION_API_KEY is not set/,
    );
  });
});

describe("createCharityCommissionLookupAdapter — source tracking", () => {
  it("reports the same source name as the bulk adapter", () => {
    assert.equal(
      createCharityCommissionLookupAdapter({ registeredNumber: "1" }).name,
      "charity_commission",
    );
  });

  it("onError logs without throwing", () => {
    assert.doesNotThrow(() =>
      createCharityCommissionLookupAdapter({ registeredNumber: "1" }).onError(
        new Error("network down"),
      ),
    );
  });
});

describe("createCharityCommissionDiscoveryAdapter", () => {
  it("applies a 7-day overlap buffer to the resolved watermark as the search start date", async () => {
    let firstSearchUrl = "";
    globalThis.fetch = routedFetch({
      onSearch: (url) => {
        firstSearchUrl ||= url;
        return jsonResponse([]);
      },
    });

    await createCharityCommissionDiscoveryAdapter({
      resolveWatermark: async () => "2026-08-09",
    }).fetch();

    // Watermark minus 7 days, formatted as YYYY-MM-DD.
    assert.ok(
      firstSearchUrl.includes("/searchCharityRegDate/2026-08-02/"),
      `expected the search to start 2026-08-02, got: ${firstSearchUrl}`,
    );
  });

  it("falls back to a 30-days-ago start when no watermark is available", async () => {
    let firstSearchUrl = "";
    globalThis.fetch = routedFetch({
      onSearch: (url) => {
        firstSearchUrl ||= url;
        return jsonResponse([]);
      },
    });

    await createCharityCommissionDiscoveryAdapter({
      resolveWatermark: async () => null,
    }).fetch();

    const expectedStart = new Date();
    expectedStart.setUTCDate(expectedStart.getUTCDate() - 30);
    const expectedStartDate = expectedStart.toISOString().slice(0, 10);

    // Not the fixed CHARITY_COMMISSION_BACKFILL_START env var (that's the manual
    // bulk-backfill button's range, deliberately not reused here — see the
    // NEVER_RUN_FALLBACK_DAYS comment in charity-commission.ts).
    assert.ok(
      firstSearchUrl.includes(`/searchCharityRegDate/${expectedStartDate}/`),
      `expected the search to start ${expectedStartDate}, got: ${firstSearchUrl}`,
    );
  });

  it("returns full detail records, same as the fixed-range bulk adapter", async () => {
    globalThis.fetch = routedFetch({});

    const { records, truncated } = await createCharityCommissionDiscoveryAdapter({
      resolveWatermark: async () => null,
    }).fetch();

    assert.equal(truncated, false);
    assert.equal(records.length, 1);
    assert.equal(records[0].source_record_id, "5254841");
  });

  it("reports its own name", () => {
    assert.equal(createCharityCommissionDiscoveryAdapter().name, "charity_commission");
  });

  it("onError logs without throwing", () => {
    assert.doesNotThrow(() =>
      createCharityCommissionDiscoveryAdapter().onError(new Error("network down")),
    );
  });
});

describe("createCharityCommissionStatusRecheckAdapter", () => {
  it("batches registered numbers into one details call", async () => {
    const detailUrls: string[] = [];
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      detailUrls.push(String(url));
      return jsonResponse([
        { ...detailResult, reg_charity_number: 1 },
        { ...detailResult, reg_charity_number: 2 },
      ]);
    });

    const result = await createCharityCommissionStatusRecheckAdapter(["1", "2"]).fetch();

    assert.equal(detailUrls.length, 1);
    assert.equal(result.records.length, 2);
    assert.equal(result.truncated, false);
  });

  it("skips a batch that fails to resolve instead of aborting the whole run", async () => {
    let calls = 0;
    // 404 (not 500): fetchWithRetry only retries 429/5xx, so a 404 fails on the
    // first attempt with no retry backoff delay — same trick
    // companieshouse.test.ts's equivalent test uses. The large batch's URL
    // (comma-joined registration numbers) always 404s; the small batch's URL (a
    // single, comma-free number) always succeeds.
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calls++;
      const isLargeBatch = String(url).includes(",");
      if (isLargeBatch) return jsonResponse({ error: "not found" }, 404);
      return jsonResponse([{ ...detailResult, reg_charity_number: 2 }]);
    });

    // Force two separate batches so one can fail independently of the other —
    // DETAILS_BATCH_SIZE is 30, so 31 numbers split into a 30-item batch and a
    // 1-item batch.
    const manyNumbers = Array.from({ length: 30 }, (_, i) => String(i + 100));
    const result = await createCharityCommissionStatusRecheckAdapter([
      ...manyNumbers,
      "2",
    ]).fetch();

    assert.equal(calls, 2);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].source_record_id, String(detailResult.organisation_number));
  });

  it("reports its own name", () => {
    assert.equal(createCharityCommissionStatusRecheckAdapter(["1"]).name, "charity_commission");
  });

  it("onError logs without throwing", () => {
    assert.doesNotThrow(() =>
      createCharityCommissionStatusRecheckAdapter(["1"]).onError(new Error("network down")),
    );
  });
});