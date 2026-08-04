import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { charityCommissionAdapter } from "./charity-commission.ts";

// ---------------------------------------------------------------------------
// globalThis.fetch mocking
//
// No existing adapter test mocks the network directly (runner.test.ts mocks
// DataSourceAdapter/IngestionStore instead, since the runner never calls
// fetch() itself). This adapter does call the real fetch(), so this file
// establishes that pattern: swap globalThis.fetch for a stub before each
// test, restore the real one after, and fast-forward node:test's mockable
// timers so the retry backoff in fetchWithRetry doesn't actually sleep.
// ---------------------------------------------------------------------------

const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.CHARITY_COMMISSION_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.CHARITY_COMMISSION_API_KEY;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const sampleRecord = {
  organisation_number: 5254841,
  reg_charity_number: 1218781,
  group_subsid_suffix: 0,
  charity_name: "THE NAZE PROTECTION SOCIETY",
  reg_status: "R",
  date_of_registration: "2026-07-07T00:00:00",
  date_of_removal: null,
};

describe("charityCommissionAdapter.fetch — successful import", () => {
  it("shapes records with the correct source_record_id and raw_payload", async () => {
    let calls = 0;
    globalThis.fetch = mock.fn(async () => {
      calls++;
      // First chunk returns data, every later chunk (covering the rest of the
      // configured range) returns empty so the loop terminates quickly.
      return calls === 1 ? jsonResponse([sampleRecord]) : jsonResponse([]);
    });

    const { records, truncated } = await charityCommissionAdapter.fetch();

    assert.equal(truncated, false);
    assert.ok(records.length >= 1);
    assert.equal(records[0].source_record_id, "5254841");
    assert.deepEqual(records[0].raw_payload, sampleRecord);
  });

  it("sends the confirmed auth header", async () => {
    let seenHeaders: Record<string, string> = {};
    globalThis.fetch = mock.fn(async (_url: string, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return jsonResponse([]);
    });

    await charityCommissionAdapter.fetch();

    assert.equal(seenHeaders["Ocp-Apim-Subscription-Key"], "test-key");
  });
});

describe("charityCommissionAdapter.fetch — API failure", () => {
  it("throws after exhausting retries on a persistent 500", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ error: "down" }, 500));

    await assert.rejects(
      () => charityCommissionAdapter.fetch(),
      /Charity Commission API returned 500/,
    );
  });

  it("recovers from a transient 429 without failing the run", async () => {
    let calls = 0;
    globalThis.fetch = mock.fn(async () => {
      calls++;
      if (calls === 1) return jsonResponse({ error: "rate limited" }, 429);
      return jsonResponse([]);
    });

    const { records } = await charityCommissionAdapter.fetch();

    assert.ok(calls >= 2, "must have retried after the 429");
    assert.deepEqual(records, []);
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
  it("throws a clear error when the response is not an array", async () => {
    globalThis.fetch = mock.fn(async () =>
      jsonResponse({ unexpected: "envelope, not an array" }),
    );

    await assert.rejects(
      () => charityCommissionAdapter.fetch(),
      /Charity Commission response is not an array/,
    );
  });

  it("does not crash shaping a record with a null date_of_removal", async () => {
    let calls = 0;
    globalThis.fetch = mock.fn(async () => {
      calls++;
      return calls === 1 ? jsonResponse([sampleRecord]) : jsonResponse([]);
    });

    const { records } = await charityCommissionAdapter.fetch();

    assert.equal(records[0].raw_payload && (records[0].raw_payload as typeof sampleRecord).date_of_removal, null);
  });
});

describe("charityCommissionAdapter.fetch — duplicate records", () => {
  it("does not itself deduplicate across chunks — that is partitionRecords' job in runner.ts", async () => {
    // The adapter's contract is "return everything the source gives back";
    // cross-request dedup happens downstream in partitionRecords, which is
    // already covered by runner.test.ts. This test documents that boundary
    // rather than re-testing partitionRecords here.
    let calls = 0;
    globalThis.fetch = mock.fn(async () => {
      calls++;
      // Same record returned in two different chunks, simulating an overlap
      // at a chunk boundary.
      return calls <= 2 ? jsonResponse([sampleRecord]) : jsonResponse([]);
    });

    const { records } = await charityCommissionAdapter.fetch();

    const ids = records.map((r) => r.source_record_id);
    assert.ok(
      ids.filter((id) => id === "5254841").length >= 2,
      "the adapter itself does not collapse duplicates — partitionRecords does",
    );
  });
});

describe("charityCommissionAdapter.fetch — source tracking", () => {
  it("reports its own name for onError, matching the DataSourceAdapter contract", () => {
    assert.equal(charityCommissionAdapter.name, "charity_commission");
  });

  it("onError logs without throwing", () => {
    assert.doesNotThrow(() =>
      charityCommissionAdapter.onError(new Error("network down")),
    );
  });
});