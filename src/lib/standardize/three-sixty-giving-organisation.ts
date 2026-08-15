// Standardise 360Giving Fields (F261) — split off F041 (#41), same as
// F260/F262 (companies-house.ts / find-that-charity.ts). See
// charity-commission.ts for the shared reasoning (AC2's "empty, not omitted"
// rule) — this file only documents what's different for this source.
//
// Deliberately does NOT include a promote-into-organisations write layer,
// even though F261's "Expected Output" describes one ("a write layer that
// promotes pending 360Giving records into organisations — same pattern as
// F041/PR #310"). That would directly reopen what F035's AC1/AC3 closed:
// three-sixty-giving.ts (F035) has its own header comment stating this in
// as many words — "Never creates an organisation — that is the whole point
// of AC1/AC3" — and its ingestion adapter (threesixtygiving.ts) says the
// same: "there is no code path here that can create an organisation".
// That guarantee exists because 360Giving is a third-party grants index, not
// an authoritative registry the way Companies House/Charity Commission are —
// a recipientOrganization 180Connect has never seen before is not evidence
// it should become a client record, only evidence a grant was made to an
// org by that name.
//
// F261's two ACs are about field-shape consistency, not persistence, and
// neither actually requires a database write:
//   AC1: every record mapped into the same ORGANISATIONS-shaped fields.
//   AC2: a field the source doesn't provide is stored empty, not omitted.
// standardizeThreeSixtyGivingOrganisationRecord below satisfies both as a
// pure function, same as every other source's mapper. It is used by
// three-sixty-giving.ts to attach a readable organisation name to the audit
// log entry for a grant whose recipient could not be matched to an existing
// client — visibility for an admin reviewing rejects, not a write path.
//
// If 360Giving is ever wanted as a genuine org-discovery source (i.e. this
// guarantee should be relaxed), that is a product decision bigger than this
// ticket and needs its own AC, not a silent reversal of F035's.

import {
  computeCompletenessScore,
  type StandardOrganisation,
} from "./types.ts";

/**
 * The subset of a 360Giving grant record this mapper reads. Declared locally
 * rather than imported from three-sixty-giving.ts's RawThreeSixtyGivingGrant
 * — same reasoning as find-that-charity.ts not importing companies-house.ts's
 * type: this module only declares the fields it actually reads. Adds `name`,
 * which three-sixty-giving.ts's own type omits because GRANTS matching never
 * needed it.
 */
export type RawThreeSixtyGivingOrganisationRecord = {
  recipientOrganization?: Array<{
    name?: unknown;
    charityNumber?: unknown;
    companyNumber?: unknown;
  }> | null;
};

/** Same assumption as charity-commission.ts/companies-house.ts/find-that-charity.ts. */
const ASSUMED_COUNTRY_CODE = "GB";

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * charityNumber/companyNumber presence is the only signal 360Giving's
 * recipientOrganization gives — "Derived from source and registration data"
 * per Data Model tab 04's organisation_type row. Both present (a
 * dual-registered charity) maps to "both", matching the enum's own option
 * for exactly this case — see threesixtygiving.ts's GB-COH-/GB-CHC- alias
 * note for the same dual-registration behaviour observed live.
 */
function deriveOrganisationType(
  hasCharityNumber: boolean,
  hasCompanyNumber: boolean,
): StandardOrganisation["organisation_type"] {
  if (hasCharityNumber && hasCompanyNumber) return "both";
  if (hasCharityNumber) return "charity";
  if (hasCompanyNumber) return "company";
  return "other";
}

/**
 * Maps one 360Giving grant record's recipientOrganization into the standard
 * ORGANISATIONS shape. Pure function — no I/O, no database, same reasoning
 * as standardizeCharityCommissionRecord.
 *
 * Only the recipient is mapped, not the funder: GRANTS.funder_name already
 * stores the funder as plain text (three-sixty-giving.ts), and a funder is
 * typically a grant-making trust/foundation, not a prospective 180Connect
 * client — there is no ORGANISATIONS use for it here.
 *
 * 360Giving's recipientOrganization carries no contact fields at all (no
 * website, no email, no address) — same gap as Find That Charity's
 * /reconcile response (find-that-charity.ts). Those stay empty rather than
 * guessed.
 */
export function standardizeThreeSixtyGivingOrganisationRecord(
  raw: RawThreeSixtyGivingOrganisationRecord,
): StandardOrganisation {
  const recipient = raw.recipientOrganization?.[0];
  const charityNumber = asTrimmedString(recipient?.charityNumber);
  const companyNumber = asTrimmedString(recipient?.companyNumber);

  const withoutScore: Omit<StandardOrganisation, "data_completeness_score"> = {
    legal_name: asTrimmedString(recipient?.name),
    trading_name: "", // not provided by this source
    country_code: ASSUMED_COUNTRY_CODE,
    is_international: false,
    entry_method: "api",
    // Same open question as every other source mapper: left false pending
    // clarification of what "verified" means here (see charity-commission.ts).
    is_verified: false,
    organisation_type: deriveOrganisationType(charityNumber !== "", companyNumber !== ""),
    website: "",
    contact_email: "",
    address_line_1: "",
    city: "",
    postcode: "",
    // geographic_reach has no source signal at all — null, not a guess.
    geographic_reach: null,
    outreach_status: "not_contacted",
    is_seed: false,
    owner_id: null,
  };

  return {
    ...withoutScore,
    data_completeness_score: computeCompletenessScore(withoutScore),
  };
}
