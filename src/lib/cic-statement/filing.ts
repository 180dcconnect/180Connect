import "server-only";

import {
  COMPANIES_HOUSE_URL,
  authenticationHeaders,
  fetchWithRetry,
} from "../ingestion/sources/companies-house-http.ts";

/**
 * Finding and fetching a company's incorporation filing.
 *
 * Two requests per company: the filing history, to learn whether there is a
 * CIC36 and where its document lives, then the document itself. The PDF is
 * returned as bytes and never written anywhere — the whole point of this job is
 * that ~400 characters of statement text is what we keep, not 1.2MB of filing.
 *
 * The filing we want is type `CICINC` ("incorporation-community-interest-
 * company"). Across fourteen sampled CICs — England, Scotland and Northern
 * Ireland — every one had exactly one, so this is a lookup rather than a search
 * through the history. A company with none is not a CIC, which is an answer.
 */

/** The filing type that carries the CIC36. */
const CIC_INCORPORATION_TYPE = "CICINC";

/**
 * A filing document runs to a megabyte or so and the API is not obliged to tell
 * us before it starts. This bounds one company's cost in the same spirit as the
 * request timeout — the largest sampled filing was 1.26MB.
 */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export type FilingOutcome =
  | { kind: "found"; pdf: Uint8Array }
  /** No CIC36 in the history. An ordinary company, not a failure. */
  | { kind: "not-a-cic" }
  /** Companies House has no record under this number at all. */
  | { kind: "unknown-company" }
  /** Something went wrong that another run might not hit. */
  | { kind: "error"; message: string };

type FilingHistoryItem = {
  type?: unknown;
  links?: { document_metadata?: unknown };
};

/**
 * The incorporation filing for one company number, or why there isn't one.
 *
 * Never throws for an expected outcome. A backfill walking several hundred
 * companies meets missing filings and unknown numbers as a matter of course,
 * and an exception per occurrence would turn ordinary bookkeeping into noise
 * that buries the failures worth reading.
 */
export async function fetchCicIncorporationFiling(
  companyNumber: string,
): Promise<FilingOutcome> {
  const headers = authenticationHeaders();

  let documentUrl: string;
  try {
    const historyResponse = await fetchWithRetry(
      `${COMPANIES_HOUSE_URL}/company/${encodeURIComponent(companyNumber)}/filing-history`,
      { ...headers, Accept: "application/json" },
    );

    if (historyResponse.status === 404) return { kind: "unknown-company" };
    if (!historyResponse.ok) {
      return { kind: "error", message: `filing history returned ${historyResponse.status}` };
    }

    const history = (await historyResponse.json()) as { items?: unknown };
    const items: FilingHistoryItem[] = Array.isArray(history.items) ? history.items : [];

    const incorporation = items.find(
      (item) => typeof item.type === "string" && item.type === CIC_INCORPORATION_TYPE,
    );
    if (!incorporation) return { kind: "not-a-cic" };

    const link = incorporation.links?.document_metadata;
    if (typeof link !== "string" || link.length === 0) {
      // A CIC36 we are told about but cannot reach. Distinct from not-a-cic:
      // this one is worth another attempt later, so it must not be recorded as
      // "asked and answered".
      return { kind: "error", message: "CICINC filing has no document link" };
    }
    documentUrl = link;
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    // The metadata URL plus /content is the bytes. `Accept: application/pdf`
    // matters — without it the API answers with the metadata JSON, which parses
    // happily as a PDF of zero pages and fails much further downstream.
    const documentResponse = await fetchWithRetry(`${documentUrl}/content`, {
      ...headers,
      Accept: "application/pdf",
    });

    if (!documentResponse.ok) {
      return { kind: "error", message: `document returned ${documentResponse.status}` };
    }

    const bytes = new Uint8Array(await documentResponse.arrayBuffer());
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      return { kind: "error", message: `document is ${bytes.byteLength} bytes` };
    }
    if (bytes.byteLength === 0) {
      return { kind: "error", message: "document was empty" };
    }

    return { kind: "found", pdf: bytes };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
