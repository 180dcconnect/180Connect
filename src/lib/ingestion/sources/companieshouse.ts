// Companies House import adapter (F032), built on the F038 ingestion contract.

import type {
  CommonRecord,
  DataSourceAdapter,
  SourceFetchResult,
} from "../type.ts";
// Credentials, timeout and retry policy live in their own module because the
// CIC36 statement job talks to the same account on the same rate limit.
import {
  COMPANIES_HOUSE_URL,
  authenticationHeaders,
  fetchWithRetry,
} from "./companies-house-http.ts";

const ITEMS_PER_PAGE = 100;
const SEARCH_RESULT_CEILING = 1000;

export type CompaniesHouseLookup =
  | { companyNumber: string }
  | { registeredName: string };

type CompaniesHouseSearchItem = {
  company_number?: unknown;
  title?: unknown;
  [key: string]: unknown;
};

type CompaniesHouseProfile = {
  company_number?: unknown;
  company_name?: unknown;
  [key: string]: unknown;
};

/** Case/punctuation/spacing-insensitive comparison; never used for display. */
export function normalizeRegisteredName(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleUpperCase("en-GB")
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeCompanyNumber(value: string): string {
  const trimmed = value.trim().toLocaleUpperCase("en-GB").replace(/\s+/g, "");
  return /^\d+$/.test(trimmed) ? trimmed.padStart(8, "0") : trimmed;
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
