import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { fetchCicIncorporationFiling } from "./filing.ts";

const originalFetch = globalThis.fetch;
const originalKey = process.env.COMPANIES_HOUSE_API_KEY;

const DOCUMENT_URL =
  "https://document-api.company-information.service.gov.uk/document/abc123";

/** A minimal PDF — enough bytes to be non-empty; nothing here parses it. */
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");

type Route = { status?: number; body?: unknown; bytes?: Uint8Array };

/** Answers the filing-history call and the document call independently, so a
 *  test can make one succeed and the other fail. */
function stubFetch(routes: { history?: Route; document?: Route }): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const route = url.includes("/document/") ? routes.document : routes.history;
    if (!route) return new Response(null, { status: 500 });
    if (route.bytes) {
      return new Response(route.bytes as unknown as BodyInit, { status: route.status ?? 200 });
    }
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

beforeEach(() => {
  process.env.COMPANIES_HOUSE_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
  else process.env.COMPANIES_HOUSE_API_KEY = originalKey;
});

describe("fetchCicIncorporationFiling", () => {
  it("returns the document bytes for a CICINC filing", async () => {
    const { calls } = stubFetch({
      history: {
        body: {
          items: [{ type: "CICINC", links: { document_metadata: DOCUMENT_URL } }],
        },
      },
      document: { bytes: PDF_BYTES },
    });

    const result = await fetchCicIncorporationFiling("17055749");

    assert.equal(result.kind, "found");
    assert.ok(result.kind === "found" && result.pdf.byteLength > 0);
    // The document is fetched from the metadata URL plus /content, not from a
    // path joined onto the JSON API's host.
    assert.equal(calls[1], `${DOCUMENT_URL}/content`);
  });

  it("picks the CICINC filing out of a longer history", async () => {
    // Real companies file confirmation statements and address changes; the
    // incorporation is not necessarily first or last.
    stubFetch({
      history: {
        body: {
          items: [
            { type: "PSC07", links: { document_metadata: "https://example.invalid/psc" } },
            { type: "AD01", links: { document_metadata: "https://example.invalid/ad01" } },
            { type: "CICINC", links: { document_metadata: DOCUMENT_URL } },
          ],
        },
      },
      document: { bytes: PDF_BYTES },
    });

    const result = await fetchCicIncorporationFiling("17047005");
    assert.equal(result.kind, "found");
  });

  it("reports not-a-cic when the history holds no CICINC", async () => {
    stubFetch({ history: { body: { items: [{ type: "AA" }, { type: "CS01" }] } } });

    // Not an error: an ordinary limited company has no community interest
    // statement, and the caller marks it checked so it is never retried.
    const result = await fetchCicIncorporationFiling("00445790");
    assert.equal(result.kind, "not-a-cic");
  });

  it("reports not-a-cic for an empty history", async () => {
    stubFetch({ history: { body: { items: [] } } });
    const result = await fetchCicIncorporationFiling("00445790");
    assert.equal(result.kind, "not-a-cic");
  });

  it("reports unknown-company for a 404", async () => {
    stubFetch({ history: { status: 404, body: { errors: [] } } });
    const result = await fetchCicIncorporationFiling("99999999");
    assert.equal(result.kind, "unknown-company");
  });

  it("errors rather than reporting not-a-cic when the document link is missing", async () => {
    stubFetch({ history: { body: { items: [{ type: "CICINC", links: {} }] } } });

    // The distinction matters to the caller: an error leaves the company
    // queued for another run, where not-a-cic closes it off for good. A CIC36
    // we were told about but could not reach must not be written off.
    const result = await fetchCicIncorporationFiling("17055749");
    assert.equal(result.kind, "error");
  });

  it("errors when the document call fails", async () => {
    stubFetch({
      history: { body: { items: [{ type: "CICINC", links: { document_metadata: DOCUMENT_URL } }] } },
      document: { status: 403, body: {} },
    });

    const result = await fetchCicIncorporationFiling("17055749");
    assert.equal(result.kind, "error");
    assert.ok(result.kind === "error" && result.message.includes("403"));
  });

  it("errors on an empty document rather than handing on zero bytes", async () => {
    stubFetch({
      history: { body: { items: [{ type: "CICINC", links: { document_metadata: DOCUMENT_URL } }] } },
      document: { bytes: new Uint8Array(0) },
    });

    const result = await fetchCicIncorporationFiling("17055749");
    assert.equal(result.kind, "error");
  });

  it("errors instead of throwing when the network fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;

    // A backfill walking hundreds of companies must not be taken down by one
    // of them.
    const result = await fetchCicIncorporationFiling("17055749");
    assert.equal(result.kind, "error");
  });

  it("throws when the API key is absent, rather than calling unauthenticated", async () => {
    delete process.env.COMPANIES_HOUSE_API_KEY;
    stubFetch({ history: { body: { items: [] } } });

    await assert.rejects(
      () => fetchCicIncorporationFiling("17055749"),
      /COMPANIES_HOUSE_API_KEY is not set/,
    );
  });
});
