// Standardise Companies House Fields (F260) — split off F041 (#41), applying
// the same mapping pattern to the companies_house source instead of
// charity_commission. See charity-commission.ts for the shared reasoning
// (AC2's "empty, not omitted" rule, the mapper/write-layer split) — this file
// only documents what's different for this source.

import {
  computeCompletenessScore,
  type StandardOrganisation,
} from "./types.ts";

/**
 * The fields from the Companies House `/company/{number}` profile
 * (stored verbatim as raw_payload) that this mapper actually reads.
 * Kept as its own type rather than importing the adapter's loosely-typed
 * CompaniesHouseProfile — this module only declares the fields it uses.
 *
 * Fields present in the API response but intentionally omitted here:
 *   - company_number: stored in raw_source_records.external_id, not re-mapped
 *     into StandardOrganisation (no corresponding field in the schema yet).
 *   - company_status:  no corresponding ORGANISATIONS field yet; could be used
 *     to filter dissolved companies in future (flagged, not built here).
 *   - address_line_2 / region / country: no corresponding ORGANISATIONS fields;
 *     country could inform is_international once F042 is ready to merge sources.
 */
export type RawCompaniesHouseRecord = {
  company_name: string;
  registered_office_address?: {
    address_line_1?: string;
    locality?: string;
    postal_code?: string;
  };
};

/**
 * Companies House only maintains registers for companies incorporated in the
 * UK (England & Wales, Scotland, Northern Ireland) — unlike
 * charity-commission.ts's ASSUMED_COUNTRY_CODE, which is a guess standing in
 * for missing data, this one reflects what the register actually covers.
 */
const ASSUMED_COUNTRY_CODE = "GB";

/**
 * Maps one raw Companies House record into the standard ORGANISATIONS shape.
 * Pure function — no I/O, no database — same reasoning as
 * standardizeCharityCommissionRecord.
 *
 * Data Dictionary note on legal_name: "Companies House takes priority over
 * CharityBase." That's a cross-source merge rule, and this mapper — like
 * charity-commission.ts's — only ever inserts a new organisations row; it has
 * no visibility into whether a CharityBase-derived row for the same
 * organisation already exists. Real priority enforcement requires comparing
 * against existing rows, which is F042 (Deduplicate Clients)'s job, not
 * built here. Flagged explicitly (same boundary write-organisations.ts draws
 * for F042/F048) rather than silently assumed away.
 */
export function standardizeCompaniesHouseRecord(
  raw: RawCompaniesHouseRecord,
): StandardOrganisation {
  const address = raw.registered_office_address ?? {};

  const withoutScore: Omit<StandardOrganisation, "data_completeness_score"> = {
    legal_name: raw.company_name ?? "",
    trading_name: "", // not provided by this source
    country_code: ASSUMED_COUNTRY_CODE,
    is_international: false,
    entry_method: "api",
    // Same open question as charity-commission.ts: whether a record from an
    // official government register counts as "verified" in this project's
    // sense is unresolved — left false pending clarification.
    is_verified: false,
    organisation_type: "company",
    // The /company profile endpoint has no contact fields at all (no
    // website, no email) — unlike Charity Commission's enrichment calls,
    // there's no richer Companies House endpoint this adapter could call for
    // these, so they stay empty rather than guessed.
    website: "",
    contact_email: "",
    address_line_1: address.address_line_1 ?? "",
    city: address.locality ?? "",
    postcode: address.postal_code ?? "",
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
