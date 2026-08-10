// Companies House import adapter (F032), built on the F038 ingestion contract.

import type {
  CommonRecord,
  DataSourceAdapter,
  SourceFetchResult,
} from "../type.ts";
import { buildAdminClient } from "../../supabase/admin-client-factory.ts";
import {
  DEFAULT_LOCATION,
  TIER_A_LEGAL_FORMS,
  TIER_B_LEGAL_FORMS,
  TIER_B_SUBTYPE,
  TIER_C_LEGAL_FORMS,
  TIER_C_SIC_ALLOWLIST,
} from "./companies-house-criteria-config.ts";

const COMPANIES_HOUSE_URL = "https://api.company-information.service.gov.uk";
const ITEMS_PER_PAGE = 100;
const SEARCH_RESULT_CEILING = 1000;
/**
 * Confirmed live (2026-08-09): /advanced-search/companies returns a 500 once
 * start_index reaches 10000, regardless of the query's total `hits` — a hard
 * pagination ceiling for this endpoint, separate from SEARCH_RESULT_CEILING
 * above (which is /search/companies, a different endpoint with its own limit).
 */
const ADVANCED_SEARCH_CEILING = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

export type CompaniesHouseLookup =
  | { companyNumber: string }
  | { registeredName: string };

/** How far back of the last known incorporation date to re-scan, to absorb any
 * registration that lands just before/after the boundary of a previous run's
 * watermark. Re-fetching an already-known company is a safe no-op — checksum
 * dedup in the ingestion runner skips it. */
const WATERMARK_OVERLAP_DAYS = 7;

type CompaniesHouseSearchItem = {
  company_number?: unknown;
  title?: unknown;
  [key: string]: unknown;
};

/** Shape confirmed live (2026-08-09) from /advanced-search/companies items. */
type CompaniesHouseAdvancedSearchItem = {
  company_number?: unknown;
  company_name?: unknown;
  registered_office_address?: unknown;
  [key: string]: unknown;
};

type CompaniesHouseProfile = {
  company_number?: unknown;
  company_name?: unknown;
  [key: string]: unknown;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function authenticationHeaders(): Record<string, string> {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (!apiKey) throw new Error("COMPANIES_HOUSE_API_KEY is not set.");
  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
  };
}

/** Case/punctuation/spacing-insensitive comparison; never used for display. */
export function normalizeRegisteredName(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleUpperCase("en-GB")
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeCompanyNumber(value: string): string {
  return value.trim().toLocaleUpperCase("en-GB").replace(/\s+/g, "");
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) return response;

      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = Number(retryAfterHeader);
      const delay = retryAfterHeader !== null && Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[companies_house] ${response.status} on attempt ${attempt}, retrying in ${delay}ms`,
      );
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[companies_house] request failed on attempt ${attempt}, retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Companies House request failed.");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    // Do not log response bodies: upstream text is not needed by users and may
    // change independently of our secret-redaction guarantees.
    throw new Error(`Companies House API returned ${response.status}.`);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("Companies House returned malformed JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Companies House returned a malformed response.");
  }
  return value as Record<string, unknown>;
}

async function searchExactRegisteredName(
  registeredName: string,
  headers: Record<string, string>,
): Promise<string> {
  const wanted = normalizeRegisteredName(registeredName);
  if (!wanted) throw new Error("Enter a registered name.");

  const exactMatches = new Map<string, CompaniesHouseSearchItem>();
  let knownTotal: number | null = null;

  for (let startIndex = 0; startIndex < SEARCH_RESULT_CEILING; startIndex += ITEMS_PER_PAGE) {
    if (knownTotal !== null && startIndex >= knownTotal) break;
    const response = await fetchWithRetry(
      `${COMPANIES_HOUSE_URL}/search/companies` +
        `?q=${encodeURIComponent(registeredName.trim())}` +
        `&items_per_page=${ITEMS_PER_PAGE}&start_index=${startIndex}`,
      headers,
    );
    const json = await readJson(response);
    if (!Array.isArray(json.items)) {
      throw new Error("Companies House response is missing an items array.");
    }
    if (typeof json.total_results === "number") knownTotal = json.total_results;

    for (const raw of json.items as CompaniesHouseSearchItem[]) {
      if (
        typeof raw.title === "string" &&
        typeof raw.company_number === "string" &&
        normalizeRegisteredName(raw.title) === wanted
      ) {
        exactMatches.set(normalizeCompanyNumber(raw.company_number), raw);
      }
    }
    if (json.items.length === 0) break;
  }

  if (exactMatches.size === 0) {
    throw new Error("No exact Companies House match was found for that registered name.");
  }
  if (exactMatches.size > 1) {
    throw new Error("More than one exact Companies House match was found; use a company number.");
  }
  return exactMatches.keys().next().value as string;
}

async function fetchCompanyProfile(
  companyNumber: string,
  headers: Record<string, string>,
): Promise<CompaniesHouseProfile> {
  const normalized = normalizeCompanyNumber(companyNumber);
  if (!/^[A-Z0-9]{2,10}$/.test(normalized)) {
    throw new Error("Enter a valid Companies House company number.");
  }

  const response = await fetchWithRetry(
    `${COMPANIES_HOUSE_URL}/company/${encodeURIComponent(normalized)}`,
    headers,
  );
  if (response.status === 404) {
    throw new Error("Companies House could not find that company number.");
  }
  const profile = await readJson(response) as CompaniesHouseProfile;
  if (typeof profile.company_number !== "string" || !profile.company_number.trim()) {
    throw new Error("Companies House profile is missing its company number.");
  }
  return profile;
}

export function shapeCompaniesHouseProfile(
  profile: CompaniesHouseProfile,
): CommonRecord {
  return {
    source_record_id: normalizeCompanyNumber(profile.company_number as string),
    raw_payload: profile,
    source_country: "GB",
    source_registry_name: "Companies House",
  };
}

/**
 * Creates one F038-compatible plug for a single organisation lookup.
 * A known number goes directly to the authoritative profile. A name is only a
 * discovery fallback and must resolve to exactly one normalized exact match.
 */
export function createCompaniesHouseAdapter(
  lookup: CompaniesHouseLookup,
): DataSourceAdapter {
  return {
    name: "companies_house",

    async fetch(): Promise<SourceFetchResult> {
      const headers = authenticationHeaders();
      const companyNumber = "companyNumber" in lookup
        ? normalizeCompanyNumber(lookup.companyNumber)
        : await searchExactRegisteredName(lookup.registeredName, headers);
      const profile = await fetchCompanyProfile(companyNumber, headers);
      return { records: [shapeCompaniesHouseProfile(profile)], truncated: false };
    },

    onError(error: Error) {
      console.error("[companies_house] ingestion failed:", error.message);
    },
  };
}

function shapeAdvancedSearchItem(
  item: CompaniesHouseAdvancedSearchItem,
): CommonRecord {
  if (typeof item.company_number !== "string" || !item.company_number.trim()) {
    throw new Error("Companies House search result is missing a company number.");
  }
  return {
    source_record_id: normalizeCompanyNumber(item.company_number),
    raw_payload: item,
    source_country: "GB",
    source_registry_name: "Companies House",
  };
}

/**
 * One page of /advanced-search/companies for a tier query.
 *
 * Confirmed live (2026-08-09): this endpoint returns HTTP 404, not 200 with an
 * empty `items` array, when a filter combination has zero current matches (e.g.
 * `company_type=royal-charter` combined with a SIC code no current royal-charter
 * company holds — the same `sic_codes` value against `company_type=ltd` returns
 * thousands of hits). A discovery tier query legitimately hits this whenever its
 * narrow legal-form/SIC combination has no current matches, so 404 here means
 * zero hits, not a failure — unlike every other call in this file, which treats
 * a non-ok response as an error via readJson.
 */
async function fetchAdvancedSearchPage(
  params: URLSearchParams,
  headers: Record<string, string>,
): Promise<{ items: CompaniesHouseAdvancedSearchItem[]; hits: number }> {
  const response = await fetchWithRetry(
    `${COMPANIES_HOUSE_URL}/advanced-search/companies?${params.toString()}`,
    headers,
  );
  if (response.status === 404) return { items: [], hits: 0 };

  const json = await readJson(response);
  if (!Array.isArray(json.items)) {
    throw new Error("Companies House response is missing an items array.");
  }
  return {
    items: json.items as CompaniesHouseAdvancedSearchItem[],
    hits: typeof json.hits === "number" ? json.hits : json.items.length,
  };
}

/** Pages one tier's query to completion (or ADVANCED_SEARCH_CEILING, whichever
 * comes first), same paging shape the old bulk adapter used for its one query. */
async function fetchAdvancedSearchTier(
  baseParams: Record<string, string>,
  headers: Record<string, string>,
): Promise<{ items: CompaniesHouseAdvancedSearchItem[]; truncated: boolean }> {
  const items: CompaniesHouseAdvancedSearchItem[] = [];
  let knownHits: number | null = null;

  for (
    let startIndex = 0;
    startIndex < ADVANCED_SEARCH_CEILING;
    startIndex += ITEMS_PER_PAGE
  ) {
    if (knownHits !== null && startIndex >= knownHits) break;

    const params = new URLSearchParams({
      ...baseParams,
      size: String(ITEMS_PER_PAGE),
      start_index: String(startIndex),
    });

    const page = await fetchAdvancedSearchPage(params, headers);
    knownHits = page.hits;
    items.push(...page.items);
    if (page.items.length === 0) break;
  }

  return { items, truncated: knownHits !== null && knownHits > ADVANCED_SEARCH_CEILING };
}

export type IncorporationWatermarkResolver = () => Promise<string | null>;

/**
 * Reads the latest `date_of_creation` already seen for companies_house, so the
 * discovery adapter can ask Companies House for only what's incorporated since
 * then (`incorporated_from`, confirmed live as a working query param). No new
 * state table — raw_source_records.raw_payload already carries this per record.
 * Returns null (full nationwide scan) when nothing has been ingested yet, or the
 * admin client isn't configured.
 */
async function defaultResolveIncorporationWatermark(): Promise<string | null> {
  const supabase = buildAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("raw_source_records")
    .select("date_of_creation:raw_payload->>date_of_creation")
    .eq("record_source", "companies_house")
    .not("raw_payload->>date_of_creation", "is", null)
    .order("raw_payload->>date_of_creation", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { date_of_creation: string | null }).date_of_creation ?? null;
}

function applyOverlapBuffer(isoDate: string, days: number): string | undefined {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Zero-input discovery: the 3-tier mission-fit rule set from
 * companies-house-criteria-config.ts, each tier run as its own
 * /advanced-search/companies query (confirmed live that comma-joined
 * `company_type`/`sic_codes` values work as OR-semantics, so each tier is one
 * query, not one per legal form). Tiers run sequentially, sharing this file's
 * existing retry/backoff, so a slow or rate-limited Companies House cannot have
 * two tier queries contending at once.
 */
export function createCompaniesHouseDiscoveryAdapter(
  options: {
    location?: string;
    resolveWatermark?: IncorporationWatermarkResolver;
  } = {},
): DataSourceAdapter {
  const resolveWatermark = options.resolveWatermark ?? defaultResolveIncorporationWatermark;

  return {
    name: "companies_house",

    async fetch(): Promise<SourceFetchResult> {
      const headers = authenticationHeaders();
      const location = options.location ?? DEFAULT_LOCATION;

      const watermark = await resolveWatermark();
      const incorporatedFrom = watermark
        ? applyOverlapBuffer(watermark, WATERMARK_OVERLAP_DAYS)
        : undefined;

      const baseParams: Record<string, string> = { company_status: "active" };
      if (location) baseParams.location = location;
      if (incorporatedFrom) baseParams.incorporated_from = incorporatedFrom;

      const tierParams: Record<string, string>[] = [
        { ...baseParams, company_type: TIER_A_LEGAL_FORMS.join(",") },
        {
          ...baseParams,
          company_type: TIER_B_LEGAL_FORMS.join(","),
          company_subtype: TIER_B_SUBTYPE,
        },
        {
          ...baseParams,
          company_type: TIER_C_LEGAL_FORMS.join(","),
          sic_codes: TIER_C_SIC_ALLOWLIST.join(","),
        },
      ];

      // Deduped by company_number across tiers — a company cannot match more
      // than one legal-form tier, but keeping a map is cheap insurance against
      // Companies House returning the same company twice within one tier's
      // pagination (already possible, per the runner's own intra-batch-dup note).
      const byNumber = new Map<string, CommonRecord>();
      let truncated = false;

      for (const params of tierParams) {
        const { items, truncated: tierTruncated } = await fetchAdvancedSearchTier(params, headers);
        if (tierTruncated) truncated = true;
        for (const raw of items) {
          const record = shapeAdvancedSearchItem(raw);
          byNumber.set(record.source_record_id, record);
        }
      }

      return { records: [...byNumber.values()], truncated };
    },

    onError(error: Error) {
      console.error("[companies_house] discovery ingestion failed:", error.message);
    },
  };
}

/**
 * Status watch for companies already promoted into organisations: refetches
 * each company's full profile so the caller can compare `company_status`
 * against what was last known and flag a change for admin review. One company
 * failing to resolve (e.g. an unexpected 404) is logged and skipped rather than
 * aborting the whole batch — same "one bad record doesn't take down the run"
 * reasoning as the runner's own invalid-record handling.
 */
export function createCompaniesHouseStatusRecheckAdapter(
  companyNumbers: readonly string[],
): DataSourceAdapter {
  return {
    name: "companies_house",

    async fetch(): Promise<SourceFetchResult> {
      const headers = authenticationHeaders();
      const records: CommonRecord[] = [];

      for (const companyNumber of companyNumbers) {
        try {
          const profile = await fetchCompanyProfile(companyNumber, headers);
          records.push(shapeCompaniesHouseProfile(profile));
        } catch (error) {
          console.warn(
            `[companies_house] status recheck skipped ${companyNumber}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return { records, truncated: false };
    },

    onError(error: Error) {
      console.error("[companies_house] status recheck failed:", error.message);
    },
  };
}
