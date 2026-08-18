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
  // Confirmed live (2026-08-17, charity 1201213): the response carries five
  // address lines, not two. They are a ladder rather than named parts — line
  // one is frequently the care-of *name*, the street sits two or three lines
  // down, and the town is the last line before the postcode.
  address_line_three?: string;
  address_line_four?: string;
  address_line_five?: string;
  address_post_code?: string;
  phone?: string;
  email?: string;
  web?: string;
};

/** Same normalisation F042's matcher uses, so a care-of name matches its charity. */
function comparableName(value: string): string {
  return value.toLowerCase().replace(/[.,()]/g, "").replace(/\s+/g, " ").trim();
}

/** A line with a number in it, or a street word, is the one worth calling the street. */
function looksLikeStreet(line: string): boolean {
  return /\d/.test(line)
    || /\b(street|road|lane|avenue|drive|close|way|court|place|square|terrace|hill|park|row|crescent|gardens?|walk|house|building|centre|center)\b/i
      .test(line);
}

/**
 * Splits the Charity Commission's five-line address ladder into a street line
 * and a town.
 *
 * The register does not label its address parts, and the shape varies per
 * charity. Confirmed live for charity 1201213: line one is "Always An
 * Alternative CIO" — the charity's own name, not an address — line three is
 * "Pack Horse Lane", and line five is "SHEFFIELD". Taking line one as
 * address_line_1, as this mapper did, put the organisation's name in its
 * address field on every record whose register entry is care-of itself, which
 * is a large share of small charities.
 *
 * Rules, in order:
 *   - Drop any line that merely repeats the charity's name.
 *   - The town is the last remaining line before the postcode, as long as
 *     something else is left to be the street.
 *   - The street is the first remaining line that looks like one, else the
 *     first remaining line.
 *
 * Nothing is invented: with one usable line, it becomes the street and the town
 * stays empty, which is what the previous behaviour produced for a well-formed
 * two-line address.
 */
export function splitCharityCommissionAddress(
  raw: Pick<
    RawCharityCommissionRecord,
    | "charity_name"
    | "address_line_one"
    | "address_line_two"
    | "address_line_three"
    | "address_line_four"
    | "address_line_five"
  >,
): { addressLine1: string; city: string } {
  const name = comparableName(raw.charity_name ?? "");
  const lines = [
    raw.address_line_one,
    raw.address_line_two,
    raw.address_line_three,
    raw.address_line_four,
    raw.address_line_five,
  ]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0 && comparableName(line) !== name);

  if (lines.length === 0) return { addressLine1: "", city: "" };
  if (lines.length === 1) return { addressLine1: lines[0], city: "" };

  const city = lines[lines.length - 1];
  const remaining = lines.slice(0, -1);
  return {
    addressLine1: remaining.find(looksLikeStreet) ?? remaining[0],
    city,
  };
}

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
  const address = splitCharityCommissionAddress(raw);

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
    address_line_1: address.addressLine1,
    // Closes the TODO that used to sit here. It said the response carried only
    // address_line_one/two so there was nothing to map a town from; confirmed
    // live on 2026-08-17 that it carries five lines and the town is the last of
    // them. See splitCharityCommissionAddress for how they are read.
    city: address.city,
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
