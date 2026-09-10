// F042 — Deduplicate Clients: the comparison test itself.
//
// Pure function, no database — same reasoning as charity-commission.ts's
// standardizeCharityCommissionRecord and runner.ts's partitionRecords: decision logic
// stays testable without Supabase. write-organisations.ts calls this before inserting
// a new organisation; it does not call it itself.
//
// Matching rules (F042 AC1 + Dependency Notes "Deduplication keys: email, registration
// number, name"):
//   1. An overlapping registration number wins outright — it is the strongest signal.
//      registrationNumbers is optional on both sides (a source may not supply a
//      number, and an organisation may have none on record). The existing side is
//      populated from organisation_identifiers (see write-organisations.ts's
//      loadExistingOrganisationsForMatching), the candidate side from the raw
//      source record — the write path closed F041's "built the table, not the write
//      path" gap, so this branch now has real data to match against.
//   2. Otherwise, a normalised name + postcode match. "Normalised" tolerates the AC's
//      named cases: "Ltd" vs "Limited", and stray whitespace/punctuation. If either side
//      is missing a postcode, name alone decides — postcode presence can't be required
//      when a third-party source routinely omits it (see charity-commission.ts's own
//      mapping, which already documents postcode as best-effort).
//
// email is listed in the ticket's dependency note as a possible key but is not used
// here: StandardOrganisation's contact_email is frequently blank on import (same
// best-effort reasoning as postcode), and an organisation-level inbox is a weak
// dedup signal on its own — revisit if false negatives turn out to be common.

export type ExistingOrganisationForMatch = {
  id: string;
  legal_name: string;
  postcode: string;
  registrationNumbers?: string[];
};

export type CandidateOrganisationForMatch = {
  legal_name: string;
  postcode: string;
  registrationNumbers?: string[];
};

export type DuplicateMatch = {
  organisationId: string;
  matchedOn: "registration_number" | "name_and_postcode";
};

/** Lowercases, strips punctuation and the "Ltd"/"Limited" suffix, collapses whitespace. */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,()]/g, "")
    .replace(/\b(ltd|limited)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalisePostcode(postcode: string): string {
  return postcode.toUpperCase().replace(/\s+/g, "");
}

export function findDuplicateMatch(
  candidate: CandidateOrganisationForMatch,
  existingOrganisations: ExistingOrganisationForMatch[],
  excludeOrganisationIds: ReadonlySet<string> = new Set(),
): DuplicateMatch | null {
  const searchable = existingOrganisations.filter(
    (organisation) => !excludeOrganisationIds.has(organisation.id),
  );

  const registrationMatch = searchable.find((organisation) =>
    candidate.registrationNumbers?.some((number) =>
      organisation.registrationNumbers?.includes(number),
    ),
  );
  if (registrationMatch) {
    return { organisationId: registrationMatch.id, matchedOn: "registration_number" };
  }

  const candidateName = normaliseName(candidate.legal_name);
  if (candidateName === "") return null; // nothing usable to match on
  const candidatePostcode = normalisePostcode(candidate.postcode);

  const nameMatch = searchable.find((organisation) => {
    if (normaliseName(organisation.legal_name) !== candidateName) return false;
    const existingPostcode = normalisePostcode(organisation.postcode);
    if (candidatePostcode === "" || existingPostcode === "") return true;
    return existingPostcode === candidatePostcode;
  });

  return nameMatch ? { organisationId: nameMatch.id, matchedOn: "name_and_postcode" } : null;
}
