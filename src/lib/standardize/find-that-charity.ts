// Standardise Find That Charity Fields (F262) — split off F041 (#41), applying
// the same mapping pattern to the find_that_charity source. See
// charity-commission.ts for the shared reasoning (AC2's "empty, not omitted"
// rule, the mapper/write-layer split) — this file only documents what's
// different for this source.
//
// Depends on F034 (Find That Charity Import, #34 — still on branch
// F034-Find-That-Charity-Import, not yet merged to dev, and itself flagged in
// docs/open-questions.md Q-07 as blocked on the source's own reliability).
// The raw payload shape read here is not imported from that branch's adapter
// (src/lib/ingestion/sources/find_that_charity.ts) — same reasoning as
// companies-house.ts not importing the adapter's CompaniesHouseProfile type:
// this module only declares the fields it actually reads, so it doesn't carry
// a hard dependency on unmerged adapter code. If the shape changes before
// F034 merges, update RawFindThatCharityRecord to match.

import {
  computeCompletenessScore,
  type StandardOrganisation,
} from "./types.ts";

/**
 * Find That Charity has no bulk import endpoint — F034's adapter reconciles
 * charity names already known from another source (today: charity_commission)
 * against Find That Charity's /reconcile endpoint, one name at a time, and
 * stores each result as its own raw_source_records row. That shape:
 *
 *   - queried_name: the clean name we searched with (from the other source's
 *     raw payload, e.g. charity_commission's charity_name).
 *   - name: Find That Charity's own label for the candidate, decorated with
 *     its org-id and status, e.g. "Oxfam (GB-CHC-202918)" or
 *     "Oxfam International Tsunami Fund (GB-CHC-1108700) [INACTIVE]" — not a
 *     clean legal_name, so not used for legal_name below (see
 *     standardizeFindThatCharityRecord).
 *   - id: Find That Charity's org-id.guide identifier for the candidate
 *     (e.g. "GB-CHC-202918"). Stored via raw_source_records.external_id
 *     (set by the ingestion layer, not this mapper), same convention as
 *     companies-house.ts's company_number note.
 *   - score / match: /reconcile's own confidence signal for this candidate.
 *     reconcileOne() (F034) falls back to the top-scoring candidate even when
 *     nothing is marked match: true, so `match: false` here does not mean "no
 *     result" — it means "our best guess was not confident". See
 *     isConfidentMatch below for how that's handled.
 */
export type RawFindThatCharityRecord = {
  queried_name: string;
  name?: string;
  id: string;
  score: number;
  match: boolean;
};

/**
 * Find That Charity only surfaces UK charity registrations (org-id.guide
 * prefixes: GB-CHC, GB-NIC, GB-SC), same reasoning as companies-house.ts's
 * ASSUMED_COUNTRY_CODE — this reflects what the source actually covers, not a
 * guess standing in for missing data.
 */
const ASSUMED_COUNTRY_CODE = "GB";

/**
 * Maps one raw Find That Charity reconcile candidate into the standard
 * ORGANISATIONS shape. Pure function — no I/O, no database — same reasoning
 * as standardizeCharityCommissionRecord / standardizeCompaniesHouseRecord.
 *
 * legal_name comes from queried_name, not Find That Charity's own `name` —
 * the latter is decorated with the org-id and an "[INACTIVE]" suffix when
 * present, which would corrupt legal_name if stored verbatim. queried_name is
 * the clean name the other source already gave us.
 *
 * Find That Charity's /reconcile response carries no contact fields at all
 * (no website, no email, no address) — same gap as Companies House's
 * /company profile endpoint (see companies-house.ts). Those stay empty
 * rather than guessed. This means F034's stated goal ("improve charity
 * profiles and contact details") is not actually deliverable from /reconcile
 * alone — flagged here since it affects what this mapper can produce, not
 * silently assumed away. A richer result would need F034's adapter to follow
 * up with GET /charity/{id} per candidate, which it does not do today.
 */
export function standardizeFindThatCharityRecord(
  raw: RawFindThatCharityRecord,
): StandardOrganisation {
  const withoutScore: Omit<StandardOrganisation, "data_completeness_score"> = {
    legal_name: raw.queried_name ?? "",
    trading_name: "", // not provided by this source
    country_code: ASSUMED_COUNTRY_CODE,
    is_international: false,
    entry_method: "api",
    // Same open question as charity-commission.ts / companies-house.ts:
    // left false pending clarification of what "verified" means here.
    is_verified: false,
    organisation_type: "charity",
    website: "", // /reconcile has no contact fields — see doc comment above.
    contact_email: "",
    address_line_1: "",
    city: "",
    postcode: "",
    // geographic_reach has no source signal at all yet — null, not a guess.
    geographic_reach: null,
    outreach_status: "not_contacted", // every new record starts un-reached.
    is_seed: false,
    owner_id: null, // unassigned on import; a CAM/admin claims it later.
  };

  return {
    ...withoutScore,
    data_completeness_score: computeCompletenessScore(withoutScore),
  };
}

/**
 * Whether a reconcile candidate is confident enough to promote. Find That
 * Charity's own `match` flag is the source's own judgement of this; a
 * candidate with `match: false` is reconcileOne()'s fallback top score, not a
 * real match (see the field doc above), and promoting it as a new
 * organisations row would be worse than not promoting it — a StandardOrganisation
 * with a wrong legal_name attached to the right raw_source_records row is
 * harder to catch later than an unpromoted row waiting for review.
 *
 * This is deliberately simpler than companies-house.ts's Tier A/B/C
 * confidence classification: it doesn't feed F047's sourceConfidence bypass
 * (organisation_type is always "charity" here, already in
 * CLIENT_CRITERIA.acceptedOrganisationTypes — see client-criteria-config.ts —
 * so there is nothing for a "strong" signal to bypass). It exists purely to
 * decide promote-vs-reject before F047 ever runs.
 */
export function isConfidentMatch(raw: RawFindThatCharityRecord): boolean {
  return raw.match === true;
}
