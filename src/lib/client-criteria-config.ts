import type { OrganisationType } from "./standardize/charity-commission.ts";

/**
 * F047's reviewable policy. Change this object (and its tests/documentation) when
 * the team agrees new criteria; the import decision code contains no hidden rules.
 */
export type ClientCriteriaConfig = {
  acceptedOrganisationTypes: readonly OrganisationType[];
  reviewOrganisationTypes: readonly OrganisationType[];
  priorityCities: readonly string[];
  priorityPostcodePrefixes: readonly string[];
  healthcareKeywords: readonly string[];
};

export const CLIENT_CRITERIA: ClientCriteriaConfig = {
  acceptedOrganisationTypes: ["charity", "both"],
  // A plain company/other record may still be a social enterprise, NGO,
  // non-profit, or socially focused startup. It needs evidence and human review.
  reviewOrganisationTypes: ["company", "other"],
  priorityCities: ["sheffield", "rotherham", "barnsley", "doncaster"],
  priorityPostcodePrefixes: ["S", "DN"],
  healthcareKeywords: ["health", "healthcare", "medical", "hospital", "patient"],
};
