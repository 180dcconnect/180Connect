// Merges what the website said with what the registers confirmed, into the draft a
// CAM reviews (F037 AC4, AC5, AC8).
//
// Pure. The precedence rules are the whole content of this module and they are worth
// asserting directly rather than through a flow that also does DNS, HTTP and RPCs.
//
// One rule underneath all of them: a register beats the website for anything a
// register holds, and the website is the only source for anything it does not. A
// charity's own homepage is where the mission lives and is nobody's authority on its
// registered address.

import { normalizeCity } from "../city.ts";
import type { WebsiteExtraction } from "./extract-organisation.ts";
import type { RegistryMatch } from "./registry-lookup.ts";
import { organisationTypeFrom } from "./registry-lookup.ts";

/** Column names on MANUAL_ENTRY_RECORDS. Snake case because that is what is stored. */
export type ImportDraftFields = {
  legal_name: string | null;
  mission_statement: string | null;
  organisation_type: "charity" | "company" | "both" | null;
  address_line_1: string | null;
  city: string | null;
  postcode: string | null;
  country_code: string | null;
  website: string | null;
  contact_email: string | null;
  registry_name: string | null;
  registry_number: string | null;
};

export type ImportDraft = {
  fields: ImportDraftFields;
  /** Exactly the fields this import filled, for imported_field_paths (AC8). */
  importedFieldPaths: string[];
  /** What was confirmed, what was not, and what a CAM should check. */
  notes: string[];
  registrySources: RegistryMatch["source"][];
  socialLinks: string[];
};

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * First non-empty value, in the order given.
 *
 * Every field below is expressed as one of these calls, so the precedence for a field
 * is readable on one line instead of spread across a chain of ifs.
 */
function preferred(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const cleaned = blankToNull(value);
    if (cleaned) return cleaned;
  }
  return null;
}

export function buildImportDraft(
  extraction: WebsiteExtraction,
  matches: RegistryMatch[],
  registryNotes: string[] = [],
): ImportDraft {
  const charity = matches.find((match) => match.source === "charity_commission");
  const company = matches.find((match) => match.source === "companies_house");
  const notes = [...registryNotes];

  // Companies House first for the legal identity fields. The Data Dictionary already
  // ranks Companies House above other sources for legal_name, and for a charitable
  // company the Charity Commission holds the working name while Companies House holds
  // the registered one. Its registered office is also a complete address, where the
  // Charity Commission response carries address lines with no separate town.
  const legalName = preferred(
    company?.organisation.legal_name,
    charity?.organisation.legal_name,
    extraction.legalName,
  );
  const addressLine1 = preferred(
    company?.organisation.address_line_1,
    charity?.organisation.address_line_1,
    extraction.addressLine1,
  );
  const city = normalizeCity(
    preferred(
      company?.organisation.city,
      charity?.organisation.city,
      extraction.city,
    ) ?? "",
  ) || null;
  const postcode = preferred(
    company?.organisation.postcode,
    charity?.organisation.postcode,
    extraction.postcode,
  )?.toUpperCase() ?? null;

  // The Charity Commission is the only one of the three with a contact inbox, and a
  // register's published address beats one lifted from a page's markup.
  const contactEmail = preferred(
    charity?.organisation.contact_email,
    extraction.contactEmail,
  )?.toLowerCase() ?? null;

  // The page the CAM actually opened, not the register's copy — registers hold
  // website fields that go stale for years, and the CAM just proved this one resolves.
  const website = preferred(extraction.website, charity?.organisation.website);

  // Only the website has this. Neither register publishes a mission statement.
  const missionStatement = blankToNull(extraction.missionStatement);

  const organisationType = organisationTypeFrom(matches);

  // One registration can be stored (MANUAL_ENTRY_RECORDS has a single registry_name /
  // registry_number pair), so a charitable company has to lose one here. The charity
  // registration is kept because it is the one a CAM quotes and the one that decides
  // eligibility. The company number is surfaced as a note so it is not lost silently
  // — ORGANISATION_IDENTIFIERS can hold both, and connecting the two is worth doing
  // once F044's identifier write path exists.
  const registration = charity ?? company;
  if (charity && company) {
    notes.push(
      `This is a charitable company: charity ${charity.registryNumber} and company ${company.registryNumber}. The charity registration is recorded; the company number is noted here.`,
    );
  }

  const fields: ImportDraftFields = {
    legal_name: legalName,
    mission_statement: missionStatement,
    organisation_type: organisationType,
    address_line_1: addressLine1,
    city,
    postcode,
    country_code: preferred(
      company?.organisation.country_code,
      charity?.organisation.country_code,
      extraction.countryCode,
    )?.toUpperCase() ?? null,
    website,
    contact_email: contactEmail,
    registry_name: registration?.registryName ?? null,
    registry_number: registration?.registryNumber ?? null,
  };

  if (matches.length === 0) {
    notes.push(
      "Nothing on this website identified it on a public register, so every value below comes from the website itself and is unverified.",
    );
  }
  if (!missionStatement) {
    notes.push("This website did not describe what the organisation does, so the mission is blank.");
  }

  return {
    fields,
    importedFieldPaths: (Object.keys(fields) as (keyof ImportDraftFields)[])
      .filter((key) => fields[key] !== null),
    notes,
    registrySources: matches.map((match) => match.source),
    socialLinks: extraction.socialLinks,
  };
}

/**
 * Which imported values the CAM has since changed.
 *
 * Called when a draft is saved so imported_field_paths keeps meaning what it says: a
 * field the CAM has retyped is theirs, not the website's, and labelling it "imported
 * from the website" on the review screen would be a lie about where a value came from.
 */
export function retainedImportedPaths(
  importedFieldPaths: readonly string[],
  original: Partial<Record<string, string | null>>,
  current: Partial<Record<string, string | null>>,
): string[] {
  return importedFieldPaths.filter(
    (path) => blankToNull(original[path]) === blankToNull(current[path]),
  );
}
