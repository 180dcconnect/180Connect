// Charity Commission adapter (F033).
//
// Two-step fetch, confirmed against real live responses (2026-08-06):
//   1. GetSearchCharityByRegDate — get the list of charity numbers registered
//      in a date range (identity/status only, no contact details).
//   2. GetCharityDetailsMulti — batch those numbers (comma-separated
//      reg_charity_number values) to get full records including contact_info
//      fields (address_line_one..five, address_post_code, phone, email, web).
//      Confirmed live: accepts multiple comma-separated numbers in one call,
//      returns an array; a removed charity (reg_status "RM") returns null for
//      every contact field rather than erroring or omitting the record.
//
// This closes the gap the team identified: F032 (Companies House) never has
// email/phone (Companies House's API doesn't collect them), so charity
// contact info has to come from here if it's needed at all.
//
// Base URL and auth header confirmed via the portal's "Try it" panel:
//   - Host: https://api.charitycommission.gov.uk/register/api
//   - Header: Ocp-Apim-Subscription-Key

import type {
  CommonRecord,
  DataSourceAdapter,
  SourceFetchResult,
} from "../type.ts";

const CHARITY_COMMISSION_URL = "https://api.charitycommission.gov.uk/register/api";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

/**
 * How wide a date range to request per search call. Confirmed a full year
 * returns fine with no pagination metadata (2026-08-02 test) — this can
 * likely go wider than 7 days, kept conservative until confirmed further.
 */
const CHUNK_DAYS = 7;

/**
 * Confirmed via live testing against the portal (2026-08-06): batches of 20,
 * 30, and 38 succeeded; 45 and 50 both failed with a 500 (not a 400 — looks
 * like a server-side limit, not a validation error). 30 is used here as a
 * safe value with margin below the confirmed failure point, not the exact
 * boundary (which sits somewhere between 38 and 45, not pinned further).
 */
const DETAILS_BATCH_SIZE = 30;

type CharityCommissionSearchItem = {
  organisation_number: number;
  reg_charity_number: number;
  group_subsid_suffix: number;
  charity_name: string;
  reg_status: "R" | "RM";
  date_of_registration: string;
  date_of_removal: string | null;
};

/** Full record shape confirmed live from GetCharityDetailsMulti. */
type CharityCommissionDetailItem = CharityCommissionSearchItem & {
  charity_type: string | null;
  address_line_one: string | null;
  address_line_two: string | null;
  address_line_three: string | null;
  address_line_four: string | null;
  address_line_five: string | null;
  address_post_code: string | null;
  phone: string | null;
  email: string | null;
  web: string | null;
  reporting_status: string;
  last_modified_time: string;
  [key: string]: unknown; // confirmed response has more fields than typed here
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Charity Commission request failed: ${String(lastError)}`);
}

function shape(raw: CharityCommissionDetailItem): CommonRecord {
  return {
    source_record_id: String(raw.organisation_number),
    raw_payload: raw,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export const charityCommissionAdapter: DataSourceAdapter = {
  name: "charity_commission",

  async fetch(): Promise<SourceFetchResult> {
    const apiKey = process.env.CHARITY_COMMISSION_API_KEY;
    if (!apiKey) {
      throw new Error("CHARITY_COMMISSION_API_KEY is not set.");
    }

    const headers = { "Ocp-Apim-Subscription-Key": apiKey };

    const registerStart = process.env.CHARITY_COMMISSION_BACKFILL_START
      ? new Date(process.env.CHARITY_COMMISSION_BACKFILL_START)
      : new Date("2000-01-01");
    const today = process.env.CHARITY_COMMISSION_BACKFILL_END
      ? new Date(process.env.CHARITY_COMMISSION_BACKFILL_END)
      : new Date();

    // Step 1: search by date range to find which charities exist in it.
    const searchResults: CharityCommissionSearchItem[] = [];
    let chunkStart = new Date(registerStart);

    while (chunkStart < today) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS);
      const boundedEnd = chunkEnd > today ? today : chunkEnd;

      const url =
        `${CHARITY_COMMISSION_URL}/searchCharityRegDate/` +
        `${formatDate(chunkStart)}/${formatDate(boundedEnd)}`;

      const res = await fetchWithRetry(url, headers);

      if (!res.ok) {
        console.error(
          `[charity_commission] search error body for ${res.status}:`,
          await res.text(),
        );
        throw new Error(`Charity Commission search API returned ${res.status}`);
      }

      const json = await res.json();
      if (!Array.isArray(json)) {
        throw new Error(
          "Charity Commission search response is not an array.",
        );
      }

      searchResults.push(...(json as CharityCommissionSearchItem[]));
      chunkStart = boundedEnd;
    }

    // Step 2: batch-fetch full contact/address details for everything found.
    const regNumbers = searchResults.map((r) => r.reg_charity_number);
    const detailRecords: CharityCommissionDetailItem[] = [];

    for (const batch of chunk(regNumbers, DETAILS_BATCH_SIZE)) {
      const url = `${CHARITY_COMMISSION_URL}/charitydetailsmulti/${batch.join(",")}`;
      const res = await fetchWithRetry(url, headers);

      if (!res.ok) {
        console.error(
          `[charity_commission] details error body for ${res.status}:`,
          await res.text(),
        );
        throw new Error(
          `Charity Commission details API returned ${res.status}`,
        );
      }

      const json = await res.json();
      if (!Array.isArray(json)) {
        throw new Error(
          "Charity Commission details response is not an array.",
        );
      }

      detailRecords.push(...(json as CharityCommissionDetailItem[]));
    }

    // No documented ceiling for either operation, unlike Companies House's
    // ~1000 search limit — truncated is always false until evidence says
    // otherwise.
    return { records: detailRecords.map(shape), truncated: false };
  },

  onError(err: Error) {
    console.error(`[charity_commission] ingestion failed:`, err.message);
  },
};