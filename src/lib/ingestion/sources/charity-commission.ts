// Charity Commission adapter (F033).
//
// Modelled directly on companieshouse.ts, the F038 reference implementation.
//
// Open question carried over from the ticket: the Charity Commission's public API
// portal documents one example operation, GetSearchCharityByRegNumber
// (`charityRegNumber/{RegisteredNumber}/{suffix}`), which looks up a charity you
// already know the registered number of. The full operation list — including
// whether there is a general search/listing endpoint suitable for a bulk import
// rather than a single-record lookup — sits behind the developer portal login and
// has not been confirmed. Until that is resolved, `fetch()` below is a scaffold:
// the request/retry/paging shape matches companiesHouseAdapter, but the actual
// endpoint, auth header, and pagination scheme are placeholders.

import type {
  CommonRecord,
  DataSourceAdapter,
  SourceFetchResult,
} from "../type.ts";

// TODO: confirm real base URL once API scope is resolved (ticket's open question).
const CHARITY_COMMISSION_URL = "https://api-portal.charitycommission.gov.uk";

const ITEMS_PER_PAGE = 100; // TODO: confirm the API's actual page size, if any.

/** TODO: confirm whether/where a result ceiling applies, as with Companies House. */
const SEARCH_RESULT_CEILING = 1000;

const REQUEST_TIMEOUT_MS = 15_000;

// TODO: confirm real rate limits — ticket only says "rate limiting is applied",
// no published numbers. Reusing Companies House's retry shape as a safe default.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

type CharityCommissionItem = {
  organisation_number: number;
  reg_charity_number: number;
  charity_name: string;
  [key: string]: unknown;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries 429 and 5xx with exponential backoff; anything else is returned as-is. */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) return res;

      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

      console.warn(
        `[charity_commission] ${res.status} on attempt ${attempt}, retrying in ${delay}ms`,
      );
      await sleep(delay);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS) break;

      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[charity_commission] request failed on attempt ${attempt} ` +
          `(${err instanceof Error ? err.message : String(err)}), retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Charity Commission request failed: ${String(lastError)}`);
}

function shape(raw: CharityCommissionItem): CommonRecord {
  return {
    source_record_id: String(raw.reg_charity_number),
    raw_payload: raw,
  };
}

export const charityCommissionAdapter: DataSourceAdapter = {
  name: "charity_commission",

  async fetch(): Promise<SourceFetchResult> {
    const apiKey = process.env.CHARITY_COMMISSION_API_KEY;
    if (!apiKey) {
      throw new Error("CHARITY_COMMISSION_API_KEY is not set.");
    }

    // TODO: confirm the real auth header. Azure API Management portals (which this
    // looks like) typically expect `Ocp-Apim-Subscription-Key: <key>` rather than
    // Basic auth — placeholder below until verified against the real portal.
    const headers = { "Ocp-Apim-Subscription-Key": apiKey };

    // TODO: this loop assumes a paged search endpoint exists, mirroring Companies
    // House. If the confirmed API only supports GetSearchCharityByRegNumber-style
    // single-record lookups, this needs a different shape entirely — likely fed a
    // list of known reg numbers rather than paging blindly.
    throw new Error(
      "Not implemented — pending confirmation of the real Charity Commission " +
        "search/listing endpoint. See comments above for what is and isn't known.",
    );

    // Reference shape, left for whoever resolves the open question above:
    //
    // const allRecords: CharityCommissionItem[] = [];
    // let knownTotal: number | null = null;
    // let startIndex = 0;
    //
    // while (startIndex < SEARCH_RESULT_CEILING) {
    //   if (knownTotal !== null && startIndex >= knownTotal) break;
    //   const res = await fetchWithRetry(
    //     `${CHARITY_COMMISSION_URL}/<endpoint>?start=${startIndex}&count=${ITEMS_PER_PAGE}`,
    //     headers,
    //   );
    //   if (!res.ok) {
    //     console.error(`[charity_commission] error body for ${res.status}:`, await res.text());
    //     throw new Error(`Charity Commission API returned ${res.status}`);
    //   }
    //   const json = await res.json();
    //   if (!Array.isArray(json.items)) {
    //     throw new Error("Charity Commission response is missing an items array.");
    //   }
    //   if (json.items.length === 0) break;
    //   allRecords.push(...json.items);
    //   startIndex += ITEMS_PER_PAGE;
    // }
    //
    // const truncated = knownTotal !== null && allRecords.length < knownTotal;
    // return { records: allRecords.map(shape), truncated };
  },

  onError(err: Error) {
    console.error(`[charity_commission] ingestion failed:`, err.message);
  },
};