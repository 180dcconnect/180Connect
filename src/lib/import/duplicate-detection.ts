// Duplicate detection for F256 Manual URL Import Failure Handling.
//
// Pure function, no database calls — follows the same pattern as F042
// (src/lib/dedup/match-organisations.ts) so matching decisions are fully testable in
// isolation.
//
// Evaluates candidates against active organisations using three key signals:
//   1. Registration numbers (Charity Commission / Companies House) — highest confidence.
//   2. Normalised organisation name + postcode (leveraging F042 findDuplicateMatch).
//   3. Normalised website origin/hostname.

import {
  findDuplicateMatch as findF042Match,
  type DuplicateMatch as F042DuplicateMatch,
} from "../dedup/match-organisations.ts";

export type ExistingOrganisationForImportMatch = {
  id: string;
  legal_name: string;
  postcode: string | null;
  website?: string | null;
  registrationNumbers?: string[];
};

export type CandidateForImportMatch = {
  legalName: string | null;
  postcode: string | null;
  website: string | null;
  registrationNumbers?: string[];
};

export type ImportDuplicateMatch = {
  organisationId: string;
  matchedOn: "registration_number" | "name_and_postcode" | "website";
};

export function normaliseHostname(url: string | null | undefined): string | null {
  if (!url || !url.trim()) return null;
  try {
    const value = url.trim();
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "").trim();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * Checks whether an imported organisation candidate matches an existing active client.
 */
export function findImportDuplicateMatch(
  candidate: CandidateForImportMatch,
  existingOrganisations: readonly ExistingOrganisationForImportMatch[],
): ImportDuplicateMatch | null {
  // 1 & 2: Registration number & Name + Postcode via F042 matching
  const f042Candidate = {
    legal_name: candidate.legalName ?? "",
    postcode: candidate.postcode ?? "",
    registrationNumbers: candidate.registrationNumbers?.filter(Boolean),
  };

  const f042Existing = existingOrganisations.map((org) => ({
    id: org.id,
    legal_name: org.legal_name,
    postcode: org.postcode ?? "",
    registrationNumbers: org.registrationNumbers,
  }));

  const f042Match: F042DuplicateMatch | null = findF042Match(f042Candidate, f042Existing);
  if (f042Match) {
    return {
      organisationId: f042Match.organisationId,
      matchedOn: f042Match.matchedOn,
    };
  }

  // 3: Website hostname matching
  const candidateHost = normaliseHostname(candidate.website);
  if (candidateHost) {
    const websiteMatch = existingOrganisations.find((org) => {
      const existingHost = normaliseHostname(org.website);
      return existingHost !== null && existingHost === candidateHost;
    });

    if (websiteMatch) {
      return {
        organisationId: websiteMatch.id,
        matchedOn: "website",
      };
    }
  }

  return null;
}
