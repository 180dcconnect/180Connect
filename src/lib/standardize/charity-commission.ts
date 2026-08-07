// Standardise Client Fields (F041) — Charity Commission mapping.
//
// Maps a raw_source_records row from the charity_commission source into the
// ORGANISATIONS shape (Data Model tab 04, F041 ticket). ORGANISATIONS itself
// already exists (built under F233) — this module does not create schema, it
// only maps.
//
// AC2: "A source that doesn't provide a value for a given standard field
// stores that field as empty rather than omitting the field entirely — every
// record has the same shape." Applied here as:
//   - text columns the source doesn't provide  -> "" (empty string)
//   - enum-typed columns (geographic_reach etc) -> null, NOT "", since an
//     empty string is not a valid value for a constrained enum column and
//     would fail the check constraint. "Empty" for an enum means "no value
//     assigned yet", which is null, not the source omitting the field.
//
// Only source-provided fields (from CharityCommissionSearchItem, i.e. what
// charity-commission.ts's fetch() actually returns today) are populated.
// GetSearchCharityByRegDate does not return website/contact_email/address/
// city/postcode — those live in GetAllCharityDetailsV2 /
// GetCharityContactInformation, which the adapter does not currently call.
// Whether to extend the adapter to fetch that enrichment data is a separate,
// still-open decision (see the NOTE at the bottom of charity-commission.ts) —
// this mapper is written to be correct either way: it reads whatever fields
// are present on the raw payload and standardises them, nothing more.

import {
  computeCompletenessScore,
  type StandardOrganisation,
} from "./types.ts";

export type {
  EntryMethod,
  OrganisationType,
  GeographicReach,
  OutreachStatus,
  StandardOrganisation,
} from "./types.ts";

/**
 * The subset of CharityCommissionSearchItem (charity-commission.ts) this
 * mapper reads. Kept as its own type, rather than importing the adapter's
 * private type, so this module doesn't create a dependency on adapter
 * internals — only on the field names the raw JSON actually has.
 */
export type RawCharityCommissionRecord = {
  organisation_number: number;
  reg_charity_number: number;
  charity_name: string;
  reg_status: "R" | "RM";
  date_of_registration: string;
  date_of_removal: string | null;
  // GetAllCharityDetailsV2 / GetCharityContactInformation fields, present
  // only if the adapter is later extended to fetch them. Optional here so
  // this mapper already handles that case without changes.
  address_line_one?: string;
  address_line_two?: string;
  address_post_code?: string;
  phone?: string;
  email?: string;
  web?: string;
};

/**
 * TODO (open decision, not resolved by the F041 or F033 tickets): the Data
 * Model doesn't say what country_code Charity Commission records should get.
 * The Charity Commission for England and Wales only registers charities
 * operating from England/Wales, so "GB" is used as a reasonable default
 * rather than left empty — but this is an assumption, not a confirmed rule,
 * and should be checked against the Data Dictionary's expected values for
 * country_code (ISO 3166-1 alpha-2 presumed, unconfirmed).
 */
const ASSUMED_COUNTRY_CODE = "GB";

/**
 * Maps one raw Charity Commission record into the standard ORGANISATIONS
 * shape. Pure function — no I/O, no database, so it's testable without
 * Supabase (per AC1/AC2, and matching this codebase's existing pattern of
 * keeping mapping/decision logic separate from the code that writes it, e.g.
 * partitionRecords in runner.ts).
 */
export function standardizeCharityCommissionRecord(
  raw: RawCharityCommissionRecord,
): StandardOrganisation {
  const withoutScore: Omit<StandardOrganisation, "data_completeness_score"> = {
    legal_name: raw.charity_name ?? "",
    trading_name: "", // not provided by this source
    country_code: ASSUMED_COUNTRY_CODE,
    is_international: false,
    entry_method: "api",
    // TODO: whether "is_verified" should be true for a record that came
    // straight from an official government register is an open question —
    // left false (unverified-by-180Connect) pending clarification, since
    // "verified" may mean something specific to this project's workflow
    // rather than "the source is authoritative".
    is_verified: false,
    organisation_type: "charity",
    website: raw.web ?? "",
    contact_email: raw.email ?? "",
    address_line_1: raw.address_line_one ?? "",
    city: "", // Data Dictionary has no separate "town/city" field in the
    // Charity Commission response used today (address_line_one/two only);
    // left empty rather than guessed from an address line.
    postcode: raw.address_post_code ?? "",
    // geographic_reach has no source signal at all yet — null, not a guess.
    geographic_reach: null,
    outreach_status: "not_contacted", // F145/F146 — the correct default for every
    // new record, not a per-source value — every organisation starts un-reached.
    is_seed: false,
    owner_id: null, // unassigned on import; a CAM/admin claims it later.
  };

  return {
    ...withoutScore,
    data_completeness_score: computeCompletenessScore(withoutScore),
  };
}
