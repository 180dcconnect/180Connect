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
  acceptedOrganisationTypes: ["charity", "both"],
  // A plain company/other record may still be a social enterprise, NGO,
  // non-profit, or socially focused startup. It needs evidence and human review.
  reviewOrganisationTypes: ["company", "other"],
  // Today just "company" — Companies House Tier A/B legal-form evidence is the
  // only strong-confidence signal this codebase produces so far.
  strongEvidenceTypes: ["company"],
  priorityCities: ["sheffield", "rotherham", "barnsley", "doncaster"],
  priorityPostcodePrefixes: ["S", "DN"],
  healthcareKeywords: ["health", "healthcare", "medical", "hospital", "patient"],
};
