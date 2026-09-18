import type { OrganisationType } from "./standardize/charity-commission.ts";

/**
 * F047's reviewable policy. Change this object (and its tests/documentation) when
 * the team agrees new criteria; the import decision code contains no hidden rules.
 */
export type ClientCriteriaConfig = {
  acceptedOrganisationTypes: readonly OrganisationType[];
  reviewOrganisationTypes: readonly OrganisationType[];
  /**
   * Organisation types where strong external evidence about legal form can
   * override the human-review requirement — e.g. Companies House Tier A/B
   * (see standardize/companies-house.ts's classifyCompaniesHouseSourceConfidence).
   * Checked only when checkClientCriteria's input carries
   * `sourceConfidence: "strong"`; a type here with no strong-confidence input
   * still falls through to reviewOrganisationTypes as before. Generic by
   * design — not Companies-House-specific — so a future source with its own
   * strong-evidence signal reuses this same mechanism.
   */
  strongEvidenceTypes: readonly OrganisationType[];
  priorityCities: readonly string[];
  priorityPostcodePrefixes: readonly string[];
  healthcareKeywords: readonly string[];
};

export const CLIENT_CRITERIA: ClientCriteriaConfig = {
  acceptedOrganisationTypes: ["charity", "cio", "cic", "social_enterprise", "both"],
  // A plain company/other/ngo record may still be a social enterprise, NGO,
  // non-profit, or socially focused startup. It needs evidence and human review.
  // ngo stays here until LLM enrichment can reliably classify it — not derived
  // from Companies House alone.
  reviewOrganisationTypes: ["company", "ngo", "other"],
  // Strong-evidence (Tier A/B legal form) now bypasses review for the new
  // CIC/CIO/social_enterprise types as well as plain company.
  strongEvidenceTypes: ["company", "cic", "cio", "social_enterprise"],
  priorityCities: ["sheffield", "rotherham", "barnsley", "doncaster"],
  priorityPostcodePrefixes: ["S", "DN"],
  healthcareKeywords: ["health", "healthcare", "medical", "hospital", "patient"],
};
