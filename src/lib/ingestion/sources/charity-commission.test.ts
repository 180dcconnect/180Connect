import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  createCharityCommissionLookupAdapter,
  createCharityCommissionDiscoveryAdapter,
  createCharityCommissionStatusRecheckAdapter,
  isBranchLocalCharity,
  type CharityCommissionDetailItem,
} from "./charity-commission.ts";

const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.CHARITY_COMMISSION_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.CHARITY_COMMISSION_API_KEY;
});

/**
 * The discovery adapter with its watermark stubbed out, which is how every test
 * below that exercises the search+details path runs it: a real watermark lookup
 * would need a Supabase admin client, and the date arithmetic is asserted
 * separately in its own describe.
 */
const discovery = () =>
  createCharityCommissionDiscoveryAdapter({ resolveWatermark: async () => null });

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
  address_line_four: "Sheffield",
  address_line_five: null,
  // Sheffield: discovery keeps only charities in the branch's postcode areas, so
  // the shared fixture has to be one that survives the filter. `remoteDetail`
  // below is the same record outside them.
  address_post_code: "S1 2HE",
  phone: "07971648901",
  email: "info@nazeprotectionsociety.org",
  web: "https://nazeprotectionsociety.org",
  reporting_status: "New",
  last_modified_time: "2026-07-13T14:48:43.52",
};

/** The same charity, registered to an address outside the branch's areas. */
const remoteDetail = { ...detailResult, address_post_code: "CO13 0JP" };

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

describe("createCharityCommissionDiscoveryAdapter.fetch — successful import", () => {
  it("returns full detail records, not just search-level fields", async () => {
    globalThis.fetch = routedFetch({});

    const { records, truncated } = await discovery().fetch();

    assert.equal(truncated, false);
    assert.ok(records.length >= 1);
    assert.equal(records[0].source_record_id, "5254841");
    const payload = records[0].raw_payload as typeof detailResult;
    assert.equal(payload.email, "info@nazeprotectionsociety.org");
    assert.equal(payload.phone, "07971648901");
    assert.equal(payload.web, "https://nazeprotectionsociety.org");
    assert.equal(payload.address_post_code, "S1 2HE");
  });

  it("sends the confirmed auth header on both search and details calls", async () => {
    const seenHeaders: Record<string, string>[] = [];
    globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenHeaders.push(init?.headers as Record<string, string>);
      if (String(url).includes("/searchCharityRegDate/")) return jsonResponse([searchResult]);
      return jsonResponse([detailResult]);
    });

    await discovery().fetch();

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

    await discovery().fetch();

    // Both numbers went into ONE details call, not two separate ones.
    assert.equal(detailUrls.length, 1);
    assert.ok(detailUrls[0].includes("1,2") || detailUrls[0].includes("1%2C2"));
  });
});

describe("createCharityCommissionDiscoveryAdapter.fetch — API failure", () => {
  it("throws when the search step fails persistently", async () => {
    globalThis.fetch = routedFetch({
      onSearch: () => jsonResponse({ error: "down" }, 500),
    });

    await assert.rejects(
      () => discovery().fetch(),
      /Charity Commission search API returned 500/,
    );
  });

  it("throws when the details step fails persistently", async () => {
    globalThis.fetch = routedFetch({
      onDetails: () => jsonResponse({ error: "down" }, 500),
    });

    await assert.rejects(
      () => discovery().fetch(),
      /Charity Commission details API returned 500/,
    );
  });

  it("throws when CHARITY_COMMISSION_API_KEY is not set", async () => {
    delete process.env.CHARITY_COMMISSION_API_KEY;

    await assert.rejects(
      () => discovery().fetch(),
      /CHARITY_COMMISSION_API_KEY is not set/,
    );
  });
});

describe("createCharityCommissionDiscoveryAdapter.fetch — missing fields / malformed response", () => {
  it("throws a clear error when the search response is not an array", async () => {
    globalThis.fetch = routedFetch({
      onSearch: () => jsonResponse({ unexpected: "envelope" }),
    });

    await assert.rejects(
      () => discovery().fetch(),
      /Charity Commission search response is not an array/,
    );
  });

  it("throws a clear error when the details response is not an array", async () => {
    globalThis.fetch = routedFetch({
      onDetails: () => jsonResponse({ unexpected: "envelope" }),
    });

    await assert.rejects(
      () => discovery().fetch(),
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
          },
        ]),
    });

    const { records } = await discovery().fetch();
    const payload = records[0].raw_payload as typeof detailResult;
    assert.equal(payload.phone, null);
    assert.equal(payload.email, null);
  });

  it("drops a record with no postcode rather than throwing on it", async () => {
    globalThis.fetch = routedFetch({
      onDetails: () =>
        jsonResponse([{ ...detailResult, address_post_code: null }]),
    });

    // A charity with no correspondence postcode cannot be shown to be local, and
    // "we could not tell" is not a reason to import it — the bulk run picks it up
    // later from its area of operation if it really is in the branch's patch.
    const { records, stats } = await discovery().fetch();
    assert.equal(records.length, 0);
    assert.deepEqual(stats, { registeredNationally: 1, local: 0 });
  });
});

describe("createCharityCommissionDiscoveryAdapter.fetch — source tracking", () => {
  it("reports its own name", () => {
    assert.equal(discovery().name, "charity_commission");
  });

  it("onError logs without throwing", () => {
    assert.doesNotThrow(() =>
      discovery().onError(new Error("network down")),
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

  it("returns full detail records, not just the search-level fields", async () => {
    globalThis.fetch = routedFetch({});

    const { records, truncated } = await createCharityCommissionDiscoveryAdapter({
      resolveWatermark: async () => null,
    }).fetch();

    assert.equal(truncated, false);
    assert.equal(records.length, 1);
    assert.equal(records[0].source_record_id, "5254841");
  });

  it("imports only charities in the branch's postcode areas", async () => {
    globalThis.fetch = routedFetch({
      onSearch: () =>
        jsonResponse([
          { ...searchResult, reg_charity_number: 1 },
          { ...searchResult, reg_charity_number: 2 },
          { ...searchResult, reg_charity_number: 3 },
        ]),
      onDetails: () =>
        jsonResponse([
          { ...detailResult, organisation_number: 1, address_post_code: "S1 2HE" },
          { ...detailResult, organisation_number: 2, address_post_code: "DN1 1AA" },
          // Swansea, not Sheffield — the case a startsWith("S") filter would let in.
          { ...detailResult, organisation_number: 3, address_post_code: "SA1 1AA" },
        ]),
    });

    const { records, stats } = await discovery().fetch();

    assert.deepEqual(
      records.map((record) => record.source_record_id).sort(),
      ["1", "2"],
    );
    assert.deepEqual(stats, { registeredNationally: 3, local: 2 });
  });

  it("reports what it saw nationally alongside what it kept", async () => {
    globalThis.fetch = routedFetch({ onDetails: () => jsonResponse([remoteDetail]) });

    const { records, stats } = await discovery().fetch();

    // The national count is the point of recording stats at all: a week where it
    // equals `local` means the postcode filter has stopped filtering.
    assert.equal(records.length, 0);
    assert.deepEqual(stats, { registeredNationally: 1, local: 0 });
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
describe("isBranchLocalCharity", () => {
  const withPostcode = (postcode: string | null) =>
    ({
      ...detailResult,
      reg_status: "R",
      address_post_code: postcode,
    }) as CharityCommissionDetailItem;

  it("accepts the branch's postcode areas", () => {
    assert.equal(isBranchLocalCharity(withPostcode("S1 2HE")), true);
    assert.equal(isBranchLocalCharity(withPostcode("S70 2AA")), true);
    assert.equal(isBranchLocalCharity(withPostcode("DN1 1AA")), true);
  });

  it("rejects areas that merely start with the same letter", () => {
    // The whole reason the area is parsed as a token: these are Swansea,
    // Sheffield-adjacent-but-not, London SE/SW, Stockport, Slough, Southampton
    // and Dorchester — roughly a tenth of the register between them.
    for (const postcode of ["SA1 1AA", "SE1 1AA", "SW1A 1AA", "SK1 1AA", "SO14 1AA", "DT1 1AA"]) {
      assert.equal(isBranchLocalCharity(withPostcode(postcode)), false, postcode);
    }
  });

  it("rejects a missing or unparseable postcode rather than guessing", () => {
    assert.equal(isBranchLocalCharity(withPostcode(null)), false);
    assert.equal(isBranchLocalCharity(withPostcode("")), false);
    assert.equal(isBranchLocalCharity(withPostcode("not a postcode")), false);
  });
});
