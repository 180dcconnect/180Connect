// Companies House adapter (F038) — the reference implementation of DataSourceAdapter.

import type {
  CommonRecord,
  DataSourceAdapter,
  SourceFetchResult,
} from "../type.ts";

const COMPANIES_HOUSE_URL = "https://api.company-information.service.gov.uk";

/** Search term for the reference implementation. Widening this is F032's job. */
const SEARCH_QUERY = "charity";

const ITEMS_PER_PAGE = 100; // Companies House's documented maximum per page.

/**
 * Companies House rejects a `start_index` past ~1000 on the search endpoint, so a
 * search matching more than that cannot be paged to the end. Runs that stop here
 * are reported as `partial`, not `completed`.
 */
const SEARCH_RESULT_CEILING = 1000;

/** Per-request timeout. Without one a hung connection hangs the whole run. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Companies House allows 600 requests per five minutes and answers 429 past that.
 * A run is 10 requests, so the limit is only reachable alongside other traffic —
 * but a 429 or a 5xx is transient by definition and worth one or two retries before
 * failing a whole run over it.
 */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

type CompaniesHouseSearchItem = {
  company_number: string;
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

      // Honour Retry-After when the server sets it; back off otherwise.
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

      console.warn(
        `[companies_house] ${res.status} on attempt ${attempt}, retrying in ${delay}ms`,
      );
      await sleep(delay);
    } catch (err) {
      // Timeout or network error. Same treatment: retry, then give up.
      lastError = err;
      if (attempt === MAX_ATTEMPTS) break;

      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[companies_house] request failed on attempt ${attempt} ` +
          `(${err instanceof Error ? err.message : String(err)}), retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Companies House request failed: ${String(lastError)}`);
}

function shape(raw: CompaniesHouseSearchItem): CommonRecord {
  return {
    source_record_id: raw.company_number,
    raw_payload: raw,
  };
}

export const companiesHouseAdapter: DataSourceAdapter = {
  name: "companies_house",

  async fetch(): Promise<SourceFetchResult> {
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      throw new Error("COMPANIES_HOUSE_API_KEY is not set.");
    }

    // Basic auth with the key as the username and an empty password.
    const encodedKey = Buffer.from(`${apiKey}:`).toString("base64");
    const allRecords: CompaniesHouseSearchItem[] = [];

    // Null until the API tells us. If it never does we cannot claim the run was
    // complete or truncated, so it is reported as complete rather than guessed at.
    let knownTotal: number | null = null;
    let startIndex = 0;

    while (startIndex < SEARCH_RESULT_CEILING) {
      if (knownTotal !== null && startIndex >= knownTotal) break;

      const res = await fetchWithRetry(
        `${COMPANIES_HOUSE_URL}/search/companies` +
          `?q=${encodeURIComponent(SEARCH_QUERY)}` +
          `&items_per_page=${ITEMS_PER_PAGE}&start_index=${startIndex}`,
        { Authorization: `Basic ${encodedKey}` },
      );

      if (!res.ok) {
        // The body carries the reason (bad key, rate limit, malformed query) where
        // the status alone does not. It does not echo the key.
        console.error(
          `[companies_house] error body for ${res.status}:`,
          await res.text(),
        );
        throw new Error(`Companies House API returned ${res.status}`);
      }

      const json = await res.json();
      if (!Array.isArray(json.items)) {
        throw new Error("Companies House response is missing an items array.");
      }
      if (typeof json.total_results === "number") {
        knownTotal = json.total_results;
      }

      // An empty page means the result set ended early, whatever total_results said.
      if (json.items.length === 0) break;

      allRecords.push(...json.items);
      startIndex += ITEMS_PER_PAGE;
    }

    // Truncated only if the source said there was more than we could reach. Hitting
    // the ceiling exactly — 1000 results, all 1000 fetched — is a complete run.
    const truncated = knownTotal !== null && allRecords.length < knownTotal;

    if (truncated) {
      console.warn(
        `[companies_house] hit the ${SEARCH_RESULT_CEILING}-record search ceiling — ` +
          `total_results was ${knownTotal}, fetched ${allRecords.length}.`,
      );
    }

    return { records: allRecords.map(shape), truncated };
  },

  onError(err: Error) {
    console.error(`[companies_house] ingestion failed:`, err.message);
  },
};
