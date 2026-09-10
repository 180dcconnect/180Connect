// Maps one bulk register extract record into the standard ORGANISATIONS shape.
//
// A separate mapper from charity-commission.ts, not a shared one, because the
// two payloads agree on almost nothing but the charity number: the API returns
// `charity_name` / `address_line_one` / `email`, the extract returns
// `charity_name` / `charity_contact_address1` / `charity_contact_email`. One
// mapper reading both would be a pile of `??` chains where a reader cannot tell
// which source a field came from — which is exactly the confusion that makes a
// field silently stop being populated when a source changes shape.
//
// Pure, no I/O, same as every other mapper here.

import { normalizeCity } from "../city.ts";
import { CLASSIFICATION_TO_SECTOR } from "../ingestion/sources/charity-commission-bulk-config.ts";
import { computeCompletenessScore, type StandardOrganisation } from "./types.ts";

/** The payload shape the bulk adapter writes into raw_source_records. */
export type RawCharityCommissionBulkRecord = {
  charity: {
    organisation_number?: number | null;
    registered_charity_number?: number | null;
    charity_name?: string | null;
    charity_registration_status?: string | null;
    charity_reporting_status?: string | null;
    date_of_registration?: string | null;
    charity_contact_address1?: string | null;
    charity_contact_address2?: string | null;
    charity_contact_address3?: string | null;
    charity_contact_address4?: string | null;
    charity_contact_address5?: string | null;
    charity_contact_postcode?: string | null;
    charity_contact_email?: string | null;
    charity_contact_web?: string | null;
    charity_company_registration_number?: string | null;
    charity_is_cio?: boolean | null;
    /** The charity's own filed description of its work. Externally authored free text. */
    charity_activities?: string | null;
  };
  annual_returns?: Record<string, unknown>[];
  matched_classifications?: string[];
  matched_areas?: string[];
};

const ASSUMED_COUNTRY_CODE = "GB";

/**
 * The register prints an address across five numbered lines with no field
 * saying which is the town. The last populated line is it — that is how the
 * register orders them, and how the API mapper reads its equivalent.
 */
function splitBulkAddress(charity: RawCharityCommissionBulkRecord["charity"]): {
  addressLine1: string;
  city: string;
} {
  const lines = [
    charity.charity_contact_address1,
    charity.charity_contact_address2,
    charity.charity_contact_address3,
    charity.charity_contact_address4,
    charity.charity_contact_address5,
  ]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0);

  if (lines.length === 0) return { addressLine1: "", city: "" };
  if (lines.length === 1) return { addressLine1: lines[0], city: "" };

  // The first populated line, not the first line that looks like a street. The
  // API mapper has to hunt for the street because its five lines can begin with
  // the charity's own name; the extract's `charity_contact_address1` is already
  // the first line of the address, so second-guessing it would demote "Unit 4"
  // below "12 High Street" and lose the unit number.
  return { addressLine1: lines[0], city: lines[lines.length - 1] };
}

/**
 * The legal form, from what the register says rather than a default.
 *
 * `charity` was the only value the API mapper could ever produce. The extract
 * carries the two facts that distinguish the forms: a CIO is its own
 * incorporated form, and a charity with a company number is a charitable
 * company — `both` in our enum. Getting this right at import time is what stops
 * the Type row on the record being a lie a CAM has to correct by hand.
 */
export function bulkOrganisationType(
  charity: RawCharityCommissionBulkRecord["charity"],
): StandardOrganisation["organisation_type"] {
  if (charity.charity_is_cio === true) return "cio";
  if ((charity.charity_company_registration_number ?? "").trim() !== "") return "both";
  return "charity";
}

/**
 * The sector this charity scores under, from the regulator's own classification.
 *
 * `organisations.sector` is empty for every row in the database today, so the
 * SCOUT sector factor is neutral for the whole book. The register already
 * classifies every charity, and the import filter only accepts classifications
 * we have a sector for — so a charity that arrives through this path arrives
 * classified, by the regulator, into the taxonomy the scorer already reads.
 *
 * A charity with several accepted classifications keeps the first in the
 * config's declaration order rather than a concatenation: `sector` is one
 * value, and the alternative is a string no scorer can match.
 */
export function bulkSector(
  matchedClassifications: readonly string[] | undefined,
): string | null {
  for (const description of Object.keys(CLASSIFICATION_TO_SECTOR)) {
    if (matchedClassifications?.includes(description)) {
      return CLASSIFICATION_TO_SECTOR[description];
    }
  }
  return null;
}

export function standardizeCharityCommissionBulkRecord(
  raw: RawCharityCommissionBulkRecord,
): StandardOrganisation {
  const charity = raw.charity ?? {};
  const address = splitBulkAddress(charity);

  const withoutScore: Omit<StandardOrganisation, "data_completeness_score"> = {
    legal_name: charity.charity_name ?? "",
    trading_name: "",
    country_code: ASSUMED_COUNTRY_CODE,
    is_international: false,
    entry_method: "api",
    // Same open question as the API mapper: "verified" means something specific
    // to this project's workflow, not "the source is authoritative".
    is_verified: false,
    organisation_type: bulkOrganisationType(charity),
    website: charity.charity_contact_web ?? "",
    contact_email: charity.charity_contact_email ?? "",
    address_line_1: address.addressLine1,
    city: normalizeCity(address.city),
    postcode: charity.charity_contact_postcode ?? "",
    // The extract does carry areas of operation, but only the ones this import
    // filtered on — enough to know the charity works here, not enough to say
    // whether it also works nationally. Null, not a guess.
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
