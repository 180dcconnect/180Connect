// Shared types for the F041-pattern source mappers (charity-commission.ts,
// companies-house.ts, and future sources standardised the same way). Split
// out of charity-commission.ts under F260 once a second mapper needed the
// same ORGANISATIONS shape — see that ticket for why this wasn't extracted
// under F041 itself (there was only one mapper then, so there was nothing to
// share yet).

export type EntryMethod = "api" | "manual";
export type OrganisationType = "charity" | "company" | "both" | "other";
export type GeographicReach =
  | "local"
  | "regional"
  | "national"
  | "international";
export type OutreachStatus =
  | "not_contacted"
  | "initial_outreach_sent"
  | "follow_up_sent"
  | "responded"
  | "converted"
  | "future_potential"
  | "soft_no"
  | "hard_no"
  | "no_response"
  | "loss_due_timing";

/**
 * The ORGANISATIONS shape every source mapper standardises into. Omits id,
 * created_at, updated_at — those are database-assigned, not something a
 * mapping function produces.
 */
export type StandardOrganisation = {
  legal_name: string;
  trading_name: string;
  country_code: string;
  is_international: boolean;
  entry_method: EntryMethod;
  is_verified: boolean;
  organisation_type: OrganisationType;
  website: string;
  contact_email: string;
  address_line_1: string;
  city: string;
  postcode: string;
  geographic_reach: GeographicReach | null;
  outreach_status: OutreachStatus;
  data_completeness_score: number;
  owner_id: string | null;
  is_seed: boolean;
};

/**
 * First-pass, unweighted heuristic (filled fields / total scoreable fields),
 * not a spec — the Data Model doesn't define how this score should be
 * calculated. Revisit once that's documented; some fields (e.g. legal_name)
 * likely matter more than others for "complete enough to act on".
 */
export function computeCompletenessScore(
  org: Omit<StandardOrganisation, "data_completeness_score">,
): number {
  const scoreable: (string | null)[] = [
    org.legal_name,
    org.trading_name,
    org.website,
    org.contact_email,
    org.address_line_1,
    org.city,
    org.postcode,
    org.geographic_reach,
  ];
  const filled = scoreable.filter((v) => v !== null && v !== "").length;
  return Math.round((filled / scoreable.length) * 100) / 100;
}
