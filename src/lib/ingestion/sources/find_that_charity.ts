// Find That Charity adapter (F034) — enrichment via /reconcile.
//
// Confirmed earlier (maintainer's own README, findthatcharity.uk/about): the
// public API has exactly two endpoints — GET /charity/{id} (single lookup by
// known ID) and GET /reconcile (OpenRefine-style name reconciliation). There
// is no bulk "list all charities" endpoint, so F034 cannot be a traditional
// import (pull unknown new records). This adapter instead reconciles charity
// names already known from another source (e.g. charity_commission) against
// Find That Charity, to enrich/cross-check them — matching the F048
// conflict-flagging framing on the original ticket.
//
// Architectural wrinkle, flagged rather than hidden: DataSourceAdapter.fetch()
// takes no arguments (the F038 socket), but reconciliation needs a name to
// search for. Every other adapter (companieshouse.ts, charity-commission.ts)
// calls its external API cold, with no dependency on this codebase's own
// data. This adapter is different — it reads names to reconcile from
// raw_source_records itself before calling the external API. That is a real
// deviation from the pattern the other adapters follow, not a minor detail;
// worth confirming with the team whether an adapter reaching into Supabase to
// decide what to fetch is the right shape for this, or whether reconciliation
// belongs as a separate pipeline stage instead of a DataSourceAdapter at all.
//
// No API key required — findthatcharity.uk is open public data.

import { buildAdminClient } from "../../supabase/admin-client-factory.ts";
import type {
  CommonRecord,
  DataSourceAdapter,
  SourceFetchResult,
} from "../type.ts";

const FIND_THAT_CHARITY_URL = "https://findthatcharity.uk";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

const MAX_NAMES_PER_RUN = 200;

type ReconcileCandidate = {
  id: string;
  name: string;
  score: number;
  match: boolean;
};

type ReconcileResponse = {
  result: ReconcileCandidate[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) return res;

      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[find_that_charity] ${res.status} on attempt ${attempt}, retrying in ${delay}ms`,
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
    : new Error(`Find That Charity request failed: ${String(lastError)}`);
}

export async function reconcileOne(
  name: string,
): Promise<ReconcileCandidate | null> {
  const query = encodeURIComponent(JSON.stringify({ q0: { query: name } }));
  const res = await fetchWithRetry(
    `${FIND_THAT_CHARITY_URL}/reconcile?queries=${query}`,
  );

  if (!res.ok) {
    console.error(
      `[find_that_charity] error body for ${res.status}:`,
      await res.text(),
    );
    throw new Error(`Find That Charity API returned ${res.status}`);
  }

  const json = await res.json();
  const forQuery: ReconcileResponse | undefined = json?.q0;
  if (!forQuery || !Array.isArray(forQuery.result)) {
    return null;
  }

  return forQuery.result.find((c) => c.match) ?? forQuery.result[0] ?? null;
}

function shape(name: string, candidate: ReconcileCandidate): CommonRecord {
  return {
    source_record_id: candidate.id,
    raw_payload: { queried_name: name, ...candidate },
  };
}

async function getNamesToReconcile(): Promise<string[]> {
  const supabase = buildAdminClient();
  if (!supabase) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const { data, error } = await supabase
    .from("raw_source_records")
    .select("name:raw_payload->>charity_name")
    .eq("record_source", "charity_commission")
    .limit(MAX_NAMES_PER_RUN);

  if (error) throw error;

  const names = (data ?? [])
    .map((row: { name: string | null }) => row.name)
    .filter((n): n is string => typeof n === "string" && n.trim() !== "");

  return Array.from(new Set(names));
}

export const findThatCharityAdapter: DataSourceAdapter = {
  name: "find_that_charity",

  async fetch(): Promise<SourceFetchResult> {
    const names = await getNamesToReconcile();
    const records: CommonRecord[] = [];

    for (const name of names.slice(0, MAX_NAMES_PER_RUN)) {
      const candidate = await reconcileOne(name);
      if (candidate) records.push(shape(name, candidate));
    }

    const truncated = names.length > MAX_NAMES_PER_RUN;
    return { records, truncated };
  },

  onError(err: Error) {
    console.error(`[find_that_charity] ingestion failed:`, err.message);
  },
};
