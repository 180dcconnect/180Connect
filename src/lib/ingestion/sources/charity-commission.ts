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
import { buildAdminClient } from "../../supabase/admin-client-factory.ts";
import { isPriorityPostcode } from "../../postcode-area.ts";

export const CHARITY_COMMISSION_URL =
  "https://api.charitycommission.gov.uk/register/api";

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
export const DETAILS_BATCH_SIZE = 30;

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
export type CharityCommissionDetailItem = CharityCommissionSearchItem & {
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

/** Retries 429 and 5xx with exponential backoff; anything else is returned as-is.
 *  Exported for charity-commission-financials.ts, which talks to the same host
 *  under the same key and must not invent a second retry policy for it. */
export async function fetchWithRetry(
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

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Shared by the bulk backfill's batching loop, the single-charity lookup below,
 *  and the financial refresh (charity-commission-financials.ts) — the same
 *  `charitydetailsmulti` call carries the latest filed year's figures. */
export async function fetchCharityDetails(
  regNumbers: (number | string)[],
  headers: Record<string, string>,
): Promise<CharityCommissionDetailItem[]> {
  const url = `${CHARITY_COMMISSION_URL}/charitydetailsmulti/${regNumbers.join(",")}`;
  const res = await fetchWithRetry(url, headers);

  if (!res.ok) {
    console.error(
      `[charity_commission] details error body for ${res.status}:`,
      await res.text(),
    );
    throw new Error(`Charity Commission details API returned ${res.status}`);
  }

  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error("Charity Commission details response is not an array.");
  }

  return json as CharityCommissionDetailItem[];
}

export type CharityCommissionLookup = { registeredNumber: string };

/** Charity Commission registration numbers are numeric (confirmed live, e.g. 1218781). */
function normalizeRegisteredNumber(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Enter a valid Charity Commission registration number.");
  }
  return trimmed;
}

/**
 * Creates one F038-compatible plug for looking up a single charity by its
 * registration number — same pattern as companieshouse.ts's
 * createCompaniesHouseAdapter, reusing the same GetCharityDetailsMulti
 * endpoint the bulk backfill batches through (confirmed live: a one-element
 * number list works the same way a full batch does).
 *
 * Number-only, unlike Companies House's number-or-name lookup: no
 * name-search endpoint has been confirmed for this API (the only search
 * operation this adapter uses elsewhere, GetSearchCharityByRegDate, searches
 * by registration date, not by name), so a name fallback isn't built here
 * without evidence it exists.
 *
 * The API does not distinguish "no charity with that number" from a real
 * server error — both return a 500 with the same generic body (confirmed
 * live) — so both surface as one message rather than a guessed distinction.
 */
export function createCharityCommissionLookupAdapter(
  lookup: CharityCommissionLookup,
): DataSourceAdapter {
  return {
    name: "charity_commission",

    async fetch(): Promise<SourceFetchResult> {
      const apiKey = process.env.CHARITY_COMMISSION_API_KEY;
      if (!apiKey) {
        throw new Error("CHARITY_COMMISSION_API_KEY is not set.");
      }
      const headers = { "Ocp-Apim-Subscription-Key": apiKey };
      const registeredNumber = normalizeRegisteredNumber(lookup.registeredNumber);

      let details: CharityCommissionDetailItem[];
      try {
        details = await fetchCharityDetails([registeredNumber], headers);
      } catch {
        throw new Error(
          "Charity Commission could not find a charity with that registration number.",
        );
      }

      if (details.length === 0) {
        throw new Error(
          "Charity Commission could not find a charity with that registration number.",
        );
      }

      return { records: [shape(details[0])], truncated: false };
    },

    onError(err: Error) {
      console.error(`[charity_commission] single lookup failed:`, err.message);
    },
  };
}

/**
 * Search by registration date, then batch-fetch full contact/address details for
 * everything found. No documented ceiling for either operation, unlike Companies
 * House's ~1000 search limit — truncated is always false until evidence says
 * otherwise.
 */
async function fetchCharitiesRegisteredBetween(
  start: Date,
  end: Date,
  headers: Record<string, string>,
): Promise<CharityCommissionDetailItem[]> {
  const searchResults: CharityCommissionSearchItem[] = [];
  let chunkStart = new Date(start);

  while (chunkStart < end) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS);
    const boundedEnd = chunkEnd > end ? end : chunkEnd;

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

  const regNumbers = searchResults.map((r) => r.reg_charity_number);
  const detailRecords: CharityCommissionDetailItem[] = [];

  for (const batch of chunk(regNumbers, DETAILS_BATCH_SIZE)) {
    detailRecords.push(...(await fetchCharityDetails(batch, headers)));
  }

  return detailRecords;
}

/**
 * Whether a newly registered charity is close enough to be worth importing.
 *
 * Discovery used to import every charity registered in England and Wales in the
 * window — 100 to 300 a week, nationally — on the reasoning that every Charity
 * Commission record maps to organisation_type "charity", which
 * CLIENT_CRITERIA.acceptedOrganisationTypes accepts unconditionally. But "is a
 * charity" is not the question. "Is a charity this branch would ever approach"
 * is, and the answer for a charity in Cornwall is no however valid its record.
 *
 * Postcode area only, deliberately — not the bulk import's fuller whitelist:
 *
 *   - **Income** cannot be tested here. These charities registered days ago;
 *     latest_income does not exist for them yet, and rejecting on a missing
 *     figure would reject the entire cohort discovery exists to find.
 *   - **Sector** cannot be tested here. The classification extract is a bulk
 *     file, and charitydetailsmulti does not carry "what the charity does".
 *   - **Area of operation** is likewise bulk-only, so the register's own answer
 *     to "where does this charity work" is not available on this path.
 *
 * That leaves the correspondence postcode, which the detail payload does carry.
 * It is a narrower test than the bulk import's (a Sheffield-working charity
 * registered to a London accountant is missed), and that is the right trade for
 * a weekly delta: the next bulk run picks such a charity up once it has filed,
 * whereas nothing ever removes the thousands of national records the unfiltered
 * version imported.
 */
export function isBranchLocalCharity(detail: CharityCommissionDetailItem): boolean {
  return isPriorityPostcode(detail.address_post_code);
}

/** How far back of the last known registration date to re-scan, to absorb any
 * registration that lands just before/after the boundary of a previous run's
 * watermark — same reasoning as companieshouse.ts's WATERMARK_OVERLAP_DAYS.
 * Re-fetching an already-known charity is a safe no-op — checksum dedup in the
 * ingestion runner skips it. */
const WATERMARK_OVERLAP_DAYS = 7;

/**
 * Fallback start when no watermark exists yet (a genuinely empty
 * raw_source_records table for this source). Deliberately NOT a full-history
 * scan back to 2000: unlike Companies House's discovery, which sends the whole
 * unbounded range as one query, this adapter must chunk client-side into
 * CHUNK_DAYS windows to satisfy the search endpoint's date-range-per-call
 * contract — a true 26-year fallback would be well over a thousand chunk calls,
 * blowing past the 300s cron timeout by orders of magnitude. A first-time
 * historical import is what the bulk register extract is for
 * (charity-commission-bulk.ts, `npm run ingest:charity-commission-bulk`), which
 * reads every registered charity from one download instead of paging the search
 * endpoint through a quarter-century of weeks; this job only needs to catch
 * anything recent if the watermark lookup itself ever comes back empty.
 */
const NEVER_RUN_FALLBACK_DAYS = 30;

export type RegistrationWatermarkResolver = () => Promise<string | null>;

/**
 * Reads the latest `date_of_registration` already seen for charity_commission, so
 * the discovery adapter can search only what's registered since then. No new state
 * table — raw_source_records.raw_payload already carries this per record, same
 * pattern as companieshouse.ts's defaultResolveIncorporationWatermark. Returns null
 * (falls back to the fixed backfill range) when nothing has been ingested yet, or
 * the admin client isn't configured.
 */
async function defaultResolveRegistrationWatermark(): Promise<string | null> {
  const supabase = buildAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("raw_source_records")
    .select("date_of_registration:raw_payload->>date_of_registration")
    .eq("record_source", "charity_commission")
    .not("raw_payload->>date_of_registration", "is", null)
    .order("raw_payload->>date_of_registration", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { date_of_registration: string | null }).date_of_registration ?? null;
}

/**
 * Zero-input discovery: searches from (the latest already-ingested registration
 * date, minus a 7-day overlap buffer) to today. This is what both the weekly cron
 * job and the manual "Check for new registrations" button call, so the two trigger
 * paths cannot drift apart — same shape as companies-house-discovery.ts /
 * createCompaniesHouseDiscoveryAdapter.
 *
 * Results are filtered to the branch's postcode areas (isBranchLocalCharity).
 * They were not, originally, on the reasoning that every Charity Commission
 * record is organisation_type "charity" and so passes F047's criteria — which is
 * true and beside the point: it imported every charity registered anywhere in
 * England and Wales, 100–300 a week, and is why the client list holds thousands
 * of organisations nobody will ever contact. See isBranchLocalCharity for why
 * postcode is the only gate available on this path.
 */
export function createCharityCommissionDiscoveryAdapter(
  options: { resolveWatermark?: RegistrationWatermarkResolver } = {},
): DataSourceAdapter {
  const resolveWatermark = options.resolveWatermark ?? defaultResolveRegistrationWatermark;

  return {
    name: "charity_commission",

    async fetch(): Promise<SourceFetchResult> {
      const apiKey = process.env.CHARITY_COMMISSION_API_KEY;
      if (!apiKey) {
        throw new Error("CHARITY_COMMISSION_API_KEY is not set.");
      }
      const headers = { "Ocp-Apim-Subscription-Key": apiKey };

      // End is always "now" — discovery means "catch up to today", not to some
      // fixed historical cutoff.
      const watermark = await resolveWatermark();
      const start = watermark
        ? (() => {
            const date = new Date(watermark);
            date.setUTCDate(date.getUTCDate() - WATERMARK_OVERLAP_DAYS);
            return date;
          })()
        : (() => {
            const date = new Date();
            date.setUTCDate(date.getUTCDate() - NEVER_RUN_FALLBACK_DAYS);
            return date;
          })();
      const end = new Date();

      const found = await fetchCharitiesRegisteredBetween(start, end, headers);
      const local = found.filter(isBranchLocalCharity);

      return {
        records: local.map(shape),
        truncated: false,
        // Recorded on the run so the admin page can say "342 registered
        // nationally, 11 of them local" rather than only "11". A week where
        // those two numbers converge means the postcode filter stopped working,
        // and nothing else we store would show it.
        stats: { registeredNationally: found.length, local: local.length },
      };
    },

    onError(err: Error) {
      console.error("[charity_commission] discovery ingestion failed:", err.message);
    },
  };
}

/**
 * Status watch for charities already promoted into organisations: refetches each
 * charity's full record via GetCharityDetailsMulti (batched, same as the bulk
 * backfill) so the caller can compare `reg_status` against what was last known and
 * flag a change for admin review. A whole batch failing to resolve (e.g. a
 * transient API error) is logged and skipped rather than aborting the run — the
 * next scheduled run picks the same records up again, since status_last_checked_at
 * is only advanced for rows that were actually touched by the caller.
 */
export function createCharityCommissionStatusRecheckAdapter(
  registeredNumbers: readonly (string | number)[],
): DataSourceAdapter {
  return {
    name: "charity_commission",

    async fetch(): Promise<SourceFetchResult> {
      const apiKey = process.env.CHARITY_COMMISSION_API_KEY;
      if (!apiKey) {
        throw new Error("CHARITY_COMMISSION_API_KEY is not set.");
      }
      const headers = { "Ocp-Apim-Subscription-Key": apiKey };

      const records: CommonRecord[] = [];
      for (const batch of chunk([...registeredNumbers], DETAILS_BATCH_SIZE)) {
        try {
          const details = await fetchCharityDetails(batch, headers);
          records.push(...details.map(shape));
        } catch (error) {
          console.warn(
            `[charity_commission] status recheck batch skipped: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return { records, truncated: false };
    },

    onError(err: Error) {
      console.error("[charity_commission] status recheck failed:", err.message);
    },
  };
}