// 360Giving Import adapter (F035), built on the F038 ingestion contract.
//
// Confirmed live 2026-08-10: https://api.threesixtygiving.org/api/v1 needs no
// auth. Registering at 360giving.org/api-docs only signs you up for email
// updates about the API — the API itself is open, rate-limited to "up to 2
// requests per user per second" per their docs.
//
//   curl -H "Accept: application/json" https://api.threesixtygiving.org/api/v1/org/GB-CHC-1164883/
//   -> {"self":...,"grants_made":...,"grants_received":...,"name":"360 Giving",...}
//
// Unlike Companies House/Charity Commission, this API has no "search all
// grants in a date range" endpoint — every query is scoped to one
// organisation (`/org/<org_id>/grants_received/`), and org_id is a registry
// number with a fixed prefix. Confirmed live: GB-CHC-<charity number> for
// charities, and GB-COH-<company number> for a dual-registered charity's
// Companies House number resolves to the same canonical record (queried
// GB-COH-09668396, got back "self": ".../GB-CHC-1164883/" — 360Giving treats
// it as an alias, not a separate organisation).
//
// That shapes the adapter: rather than discovering new organisations (F032/
// F033's job), this only ever enriches organisations we already know about —
// it walks every uk_charity/uk_company identifier already in
// organisation_identifiers and asks 360Giving what it has for each. AC1/AC3
// (only ever attach to an existing charity, never create one) fall out of
// that for free: there is no code path here that can create an organisation
// — matching against GRANTS happens in ../standardize/three-sixty-giving.ts,
// using the recipientOrganization identifiers already embedded in each
// grant's own payload, not anything smuggled in at fetch time.

import type {
  CommonRecord,
  DataSourceAdapter,
  SourceFetchResult,
} from "../type.ts";
import { buildAdminClient } from "../../supabase/admin-client-factory.ts";

const THREESIXTYGIVING_URL = "https://api.threesixtygiving.org/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const GRANTS_PAGE_SIZE = 1000;

/** Confirmed live: no auth needed. Kept below the documented 2 req/sec ceiling. */
const REQUEST_INTERVAL_MS = 600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries 429 and 5xx with exponential backoff; anything else is returned as-is. */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) return res;

      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

      console.warn(`[360giving] ${res.status} on attempt ${attempt}, retrying in ${delay}ms`);
      await sleep(delay);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`360Giving request failed: ${String(lastError)}`);
}

type GrantsReceivedResponse = {
  count: number;
  next: string | null;
  results: Array<{ grant_id: string; data: Record<string, unknown> }>;
};

function shape(item: { grant_id: string; data: Record<string, unknown> }): CommonRecord {
  return {
    source_record_id: item.grant_id,
    raw_payload: item.data,
  };
}

/** Registry-number identifiers this adapter knows how to turn into a 360Giving org_id. */
const ORG_ID_PREFIX: Record<string, string> = {
  uk_charity: "GB-CHC-",
  uk_company: "GB-COH-",
};

/** Paginates through one organisation's grants_received, following `next` until exhausted. */
async function fetchGrantsForOrgId(orgId: string): Promise<CommonRecord[]> {
  const records: CommonRecord[] = [];
  let url: string | null =
    `${THREESIXTYGIVING_URL}/org/${orgId}/grants_received/?limit=${GRANTS_PAGE_SIZE}`;

  while (url) {
    const res = await fetchWithRetry(url);
    // Not an error: most organisations we know about have never received a
    // 360Giving-published grant, and this endpoint 404s for any org_id it
    // has no record of at all (confirmed live: {"detail":"Not found."}).
    if (res.status === 404) return records;

    if (!res.ok) {
      throw new Error(`360Giving grants_received returned ${res.status} for ${orgId}`);
    }

    const json = (await res.json()) as GrantsReceivedResponse;
    records.push(...json.results.map(shape));
    url = json.next;
    if (url) await sleep(REQUEST_INTERVAL_MS);
  }

  return records;
}

export type ThreeSixtyGivingLookup =
  | { charityNumber: string }
  | { companyNumber: string };

function lookupToOrgId(lookup: ThreeSixtyGivingLookup): string {
  if ("charityNumber" in lookup) {
    const trimmed = lookup.charityNumber.trim();
    if (!trimmed) throw new Error("Enter a Charity Commission registration number.");
    return `${ORG_ID_PREFIX.uk_charity}${trimmed}`;
  }
  const trimmed = lookup.companyNumber.trim();
  if (!trimmed) throw new Error("Enter a Companies House company number.");
  return `${ORG_ID_PREFIX.uk_company}${trimmed}`;
}

/**
 * Single-organisation lookup — same pattern as
 * createCharityCommissionLookupAdapter/createCompaniesHouseAdapter: an admin
 * enters one known registry number and only that organisation's grants are
 * fetched, without walking the whole identifiers table.
 */
export function createThreeSixtyGivingLookupAdapter(
  lookup: ThreeSixtyGivingLookup,
): DataSourceAdapter {
  return {
    name: "360giving",

    async fetch(): Promise<SourceFetchResult> {
      const orgId = lookupToOrgId(lookup);
      const records = await fetchGrantsForOrgId(orgId);
      // A single-organisation lookup always walks exactly one org — even when
      // it has no grants, that is a real result, not an empty walk.
      return { records, truncated: false, walkedOrganisations: 1 };
    },

    onError(err: Error) {
      console.error(`[360giving] single lookup failed:`, err.message);
    },
  };
}

export type OrganisationIdentifier = { identifier_type: string; identifier_value: string };
export type IdentifierLoader = () => Promise<OrganisationIdentifier[]>;

const IDENTIFIERS_PAGE_SIZE = 1000;

async function defaultLoadIdentifiers(): Promise<OrganisationIdentifier[]> {
  const supabase = buildAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  // Paged, same reason write-organisations.ts's fetchAllPages exists: PostgREST
  // caps an unbounded .select() at 1000 rows by default, so a plain query here
  // would silently stop walking past row 1000 — 125 of 1125 identifiers were
  // missed that way on the first live smoke-test run (2026-08-28).
  const all: OrganisationIdentifier[] = [];
  for (let from = 0; ; from += IDENTIFIERS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("organisation_identifiers")
      .select("identifier_type, identifier_value")
      .in("identifier_type", ["uk_charity", "uk_company"])
      .range(from, from + IDENTIFIERS_PAGE_SIZE - 1);

    if (error) throw new Error(`Could not load organisation identifiers: ${error.message}`);
    const page = (data ?? []) as OrganisationIdentifier[];
    all.push(...page);
    if (page.length < IDENTIFIERS_PAGE_SIZE) break;
  }
  return all;
}

/**
 * Bulk adapter: walks every known uk_charity/uk_company identifier and asks
 * 360Giving what it has for each. Cost is O(known organisations), not
 * O(360Giving's dataset) — the inverse of Companies House/Charity
 * Commission's shape. Not yet resolved: at 2 req/sec, a run against
 * thousands of identifiers will run well past a serverless timeout — the
 * same unresolved risk already flagged on the Charity Commission admin page
 * (src/app/admin/charity-commission/page.tsx), restated here rather than
 * silently repeated.
 */
export function createThreeSixtyGivingAdapter(
  options: { loadIdentifiers?: IdentifierLoader } = {},
): DataSourceAdapter {
  const loadIdentifiers = options.loadIdentifiers ?? defaultLoadIdentifiers;

  return {
    name: "360giving",

    async fetch(): Promise<SourceFetchResult> {
      const identifiers = await loadIdentifiers();
      const walkable = identifiers.filter(
        (identifier) => ORG_ID_PREFIX[identifier.identifier_type],
      );
      const records: CommonRecord[] = [];
      const seenSourceRecordIds = new Set<string>();

      for (const identifier of walkable) {
        const prefix = ORG_ID_PREFIX[identifier.identifier_type];
        const orgRecords = await fetchGrantsForOrgId(`${prefix}${identifier.identifier_value}`);
        for (const record of orgRecords) {
          // The same grant can surface twice if an organisation has both a
          // uk_charity and uk_company identifier (dual-registered charities
          // are common, per the GB-COH- alias behaviour noted above).
          // Checksum dedup in the ingestion runner would also catch this,
          // but skipping it here avoids the wasted write.
          if (seenSourceRecordIds.has(record.source_record_id)) continue;
          seenSourceRecordIds.add(record.source_record_id);
          records.push(record);
        }

        await sleep(REQUEST_INTERVAL_MS);
      }

      return {
        records,
        truncated: false,
        // How many identifiers the walk actually asked about (types without a
        // registry-number prefix, e.g. website, are excluded) — lets callers
        // tell "walked nothing because there are no registry numbers on
        // record" apart from "walked N and 360Giving had no grants for any".
        walkedOrganisations: walkable.length,
      };
    },

    onError(err: Error) {
      console.error(`[360giving] ingestion failed:`, err.message);
    },
  };
}
