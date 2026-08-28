import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  createThreeSixtyGivingAdapter,
  createThreeSixtyGivingLookupAdapter,
} from "./threesixtygiving.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function grantsPage(
  results: Array<{ grant_id: string; data: Record<string, unknown> }>,
  next: string | null = null,
) {
  return Response.json({ count: results.length, next, previous: null, results });
}

describe("createThreeSixtyGivingLookupAdapter", () => {
  it("builds a GB-CHC- org_id from a charity number and shapes the results", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return grantsPage([
        { grant_id: "360G-funder-1", data: { id: "360G-funder-1", title: "Grant one" } },
      ]);
    };

    const result = await createThreeSixtyGivingLookupAdapter({
      charityNumber: " 1164883 ",
    }).fetch();

    assert.equal(
      requestedUrl,
      "https://api.threesixtygiving.org/api/v1/org/GB-CHC-1164883/grants_received/?limit=1000",
    );
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].source_record_id, "360G-funder-1");
    assert.deepEqual(result.records[0].raw_payload, { id: "360G-funder-1", title: "Grant one" });
    assert.equal(result.truncated, false);
    assert.equal(result.walkedOrganisations, 1);
  });

  it("builds a GB-COH- org_id from a company number", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return grantsPage([]);
    };

    await createThreeSixtyGivingLookupAdapter({ companyNumber: "09668396" }).fetch();

    assert.equal(
      requestedUrl,
      "https://api.threesixtygiving.org/api/v1/org/GB-COH-09668396/grants_received/?limit=1000",
    );
  });

  it("rejects an empty charity number without calling the API", async () => {
    globalThis.fetch = async () => {
      throw new Error("should not be called");
    };

    await assert.rejects(
      () => createThreeSixtyGivingLookupAdapter({ charityNumber: "  " }).fetch(),
      /Enter a Charity Commission registration number/,
    );
  });

  it("treats a 404 as no grants, not an error", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Not found." }), { status: 404 });

    const result = await createThreeSixtyGivingLookupAdapter({
      charityNumber: "9999999999",
    }).fetch();

    assert.deepEqual(result.records, []);
  });

  it("follows pagination via the `next` URL until exhausted", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("offset")) {
        return grantsPage([{ grant_id: "360G-b", data: { id: "360G-b" } }]);
      }
      return grantsPage(
        [{ grant_id: "360G-a", data: { id: "360G-a" } }],
        "https://api.threesixtygiving.org/api/v1/org/GB-CHC-1164883/grants_received/?limit=1000&offset=1000",
      );
    };

    const result = await createThreeSixtyGivingLookupAdapter({
      charityNumber: "1164883",
    }).fetch();

    assert.equal(calls.length, 2);
    assert.deepEqual(
      result.records.map((r) => r.source_record_id),
      ["360G-a", "360G-b"],
    );
  });

  it("retries a 500 and succeeds on a later attempt", async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (attempts < 2) return new Response("error", { status: 500 });
      return grantsPage([{ grant_id: "360G-a", data: { id: "360G-a" } }]);
    };

    const result = await createThreeSixtyGivingLookupAdapter({
      charityNumber: "1164883",
    }).fetch();

    assert.equal(attempts, 2);
    assert.equal(result.records.length, 1);
  });
});

describe("createThreeSixtyGivingAdapter", () => {
  it("queries every known uk_charity/uk_company identifier, skipping other types", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
      requestedUrls.push(String(input));
      return grantsPage([]);
    };

    const result = await createThreeSixtyGivingAdapter({
      loadIdentifiers: async () => [
        { identifier_type: "uk_charity", identifier_value: "1164883" },
        { identifier_type: "uk_company", identifier_value: "09668396" },
        { identifier_type: "website", identifier_value: "https://example.org" },
      ],
    }).fetch();

    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[0].includes("GB-CHC-1164883"), true);
    assert.equal(requestedUrls[1].includes("GB-COH-09668396"), true);
    assert.equal(result.walkedOrganisations, 2);
  });

  it("reports zero walked when only non-walkable identifiers exist", async () => {
    globalThis.fetch = async () => {
      throw new Error("should not be called");
    };

    const result = await createThreeSixtyGivingAdapter({
      loadIdentifiers: async () => [
        { identifier_type: "manual", identifier_value: "1201213" },
      ],
    }).fetch();

    assert.deepEqual(result.records, []);
    assert.equal(result.walkedOrganisations, 0);
  });

  it("collapses the same grant found under two identifiers for the same organisation", async () => {
    globalThis.fetch = async () =>
      grantsPage([{ grant_id: "360G-shared", data: { id: "360G-shared" } }]);

    const result = await createThreeSixtyGivingAdapter({
      loadIdentifiers: async () => [
        { identifier_type: "uk_charity", identifier_value: "1164883" },
        { identifier_type: "uk_company", identifier_value: "09668396" },
      ],
    }).fetch();

    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].source_record_id, "360G-shared");
  });
});
