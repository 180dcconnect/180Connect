// Charity Commission adapter (F033).
//
// Modelled on companieshouse.ts, the F038 reference implementation.
//
// Base URL and auth header confirmed directly from the interactive "Try it"
// panel on api-portal.charitycommission.gov.uk (2026-08-02):
//   - Host: https://api.charitycommission.gov.uk/register/api
//   - Header: Ocp-Apim-Subscription-Key
//
// Confirmed via a real test call through the portal's "Try it" panel
// (2026-08-03, full year 2024 range): response is a flat JSON array, fields
// match exactly (organisation_number, reg_charity_number, group_subsid_suffix,
// charity_name, reg_status, date_of_registration, date_of_removal). No
// pagination metadata of any kind (no total/next/hasMore) — hundreds of
// records returned for a full year with no error, so CHUNK_DAYS below is a
// conservative starting point, not a confirmed requirement; it can likely be
// widened significantly once this is running for real.
//
// Still open:
//   - Whether GetAllCharityDetailsV2 / GetCharityDetailsMulti enrichment (full
//     address, contact info, classifications) belongs in this adapter or a later
//     pipeline stage — GetSearchCharityByRegDate alone does not return contact
//     details. Left out of fetch() for now; see the comment at the bottom.

import type {
  CommonRecord,
  DataSourceAdapter,
  SourceFetchResult,
} from "../type.ts";

// Confirmed via the portal's interactive "Try it" panel (GetAllCharityDetails
// request preview showed the real host — see comment block above).
const CHARITY_COMMISSION_URL = "https://api.charitycommission.gov.uk/register/api";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

/**
 * How wide a date range to request per call. Chosen conservatively since
 * GetSearchCharityByRegDate's pagination behaviour on a wide range is
 * unconfirmed — a narrower window is safer until that's verified against the
 * real API, even though it means more requests for a full backfill.
 */
const CHUNK_DAYS = 7;

type CharityCommissionSearchItem = {
  organisation_number: number;
  reg_charity_number: number;
  group_subsid_suffix: number;
  charity_name: string;
  reg_status: "R" | "RM";
  date_of_registration: string;
  date_of_removal: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
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

function shape(raw: CharityCommissionSearchItem): CommonRecord {
  return {
    source_record_id: String(raw.organisation_number),
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

    // Confirmed header name, per the portal's Try-it panel.
    const headers = { "Ocp-Apim-Subscription-Key": apiKey };

    // Configurable via env so a narrow test range doesn't require editing
    // code (CHARITY_COMMISSION_BACKFILL_START/_END, both optional).
    // TODO: confirm the real start of the register's history, or agree a
    // reasonable default backfill cutoff with the team — 2000-01-01 is a
    // placeholder default, not a confirmed register start.
    const registerStart = process.env.CHARITY_COMMISSION_BACKFILL_START
      ? new Date(process.env.CHARITY_COMMISSION_BACKFILL_START)
      : new Date("2000-01-01");
    const today = process.env.CHARITY_COMMISSION_BACKFILL_END
      ? new Date(process.env.CHARITY_COMMISSION_BACKFILL_END)
      : new Date();

    const allRecords: CharityCommissionSearchItem[] = [];
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
          `[charity_commission] error body for ${res.status}:`,
          await res.text(),
        );
        throw new Error(`Charity Commission API returned ${res.status}`);
      }

      const json = await res.json();
      if (!Array.isArray(json)) {
        throw new Error(
          "Charity Commission response is not an array — check whether the " +
            "operation wraps results in an envelope object instead.",
        );
      }

      allRecords.push(...(json as CharityCommissionSearchItem[]));
      chunkStart = boundedEnd;
    }

    // No documented ceiling for this operation, unlike Companies House's ~1000
    // search limit — truncated is always false until evidence says otherwise.
    return { records: allRecords.map(shape), truncated: false };

    // NOTE: this only gets identity + registration status, not address, phone,
    // email (those live in GetCharityContactInformation / GetAllCharityDetailsV2,
    // one call per charity). Whether F033 needs that enrichment inside this
    // adapter or as a later pipeline stage is a scope question for the team —
    // F041 (standard field structure) likely governs this.
  },

  onError(err: Error) {
    console.error(`[charity_commission] ingestion failed:`, err.message);
  },
};