// Find That Charity adapter (F034).
//
// Modelled on companieshouse.ts, the F038 reference implementation.
//
// Open question carried over from the ticket ("depends on feasibility" / "access
// and data quality"): the public API at findthatcharity.uk only exposes two
// endpoints per the maintainer's own README —
//   - GET /charity/{id}      look up one charity you already know the ID of
//   - GET /reconcile         OpenRefine-style name reconciliation/search
// There is no bulk "list all charities" or "list records updated since X"
// endpoint. This means F034 as a bulk import (pull unknown new/updated records)
// is not buildable against the public API as it stands — this needs a decision
// from the team on how to reframe the ticket, e.g.:
//   (a) enrichment: take charity numbers already imported from another source
//       (F033, Companies House) and cross-check/enrich them via /reconcile, or
//   (b) look for a downloadable bulk dataset dump, if one exists, rather than
//       the live API.
// `fetch()` below is left unimplemented pending that decision. No API key is
// required for this service — it's open public data, unlike Charity Commission.

import type {
  CommonRecord,
  DataSourceAdapter,
  SourceFetchResult,
} from "../type.ts";

const FIND_THAT_CHARITY_URL = "https://findthatcharity.uk";

const REQUEST_TIMEOUT_MS = 15_000;

type FindThatCharityItem = {
  id: string; // e.g. "GB-CHC-1234567" — Find That Charity's OrgID format
  name?: string;
  [key: string]: unknown;
};

function shape(raw: FindThatCharityItem): CommonRecord {
  return {
    source_record_id: raw.id,
    raw_payload: raw,
  };
}

export const findThatCharityAdapter: DataSourceAdapter = {
  name: "find_that_charity",

  async fetch(): Promise<SourceFetchResult> {
    // No API key needed for this source — public data, per findthatcharity.uk/about.
    //
    // TODO: this cannot be implemented as a bulk import until the team decides how
    // to reframe F034 (see comment block above). There is no endpoint that returns
    // "all charities" or "charities changed since X" — only single-record lookup
    // by known ID (/charity/{id}.json) and name-based reconciliation (/reconcile).
    throw new Error(
      "Not implemented — Find That Charity's public API has no bulk-listing " +
        "endpoint. See comments above; needs a team decision on scope before " +
        "this can be built.",
    );

    // Reference shape for option (a) — enrichment via reconciliation, once the
    // caller passes in charity names/numbers already known from another source:
    //
    // async function reconcileOne(name: string): Promise<FindThatCharityItem | null> {
    //   const res = await fetch(
    //     `${FIND_THAT_CHARITY_URL}/reconcile?query=${encodeURIComponent(name)}`,
    //     { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    //   );
    //   if (!res.ok) throw new Error(`Find That Charity reconcile returned ${res.status}`);
    //   const json = await res.json();
    //   return json.result?.[0] ?? null; // OpenRefine reconciliation response shape
    // }
  },

  onError(err: Error) {
    console.error(`[find_that_charity] ingestion failed:`, err.message);
  },
};