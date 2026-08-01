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

type CompaniesHouseSearchItem = {
  company_number: string;
  [key: string]: unknown;
};

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

      const res = await fetch(
        `${COMPANIES_HOUSE_URL}/search/companies` +
          `?q=${encodeURIComponent(SEARCH_QUERY)}` +
          `&items_per_page=${ITEMS_PER_PAGE}&start_index=${startIndex}`,
        { headers: { Authorization: `Basic ${encodedKey}` } },
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
