import { z } from "zod";
import {
  checkClientCriteria,
  type ClientCriteriaInput,
} from "./client-criteria.ts";
import {
  validateClientEmail,
  type ClientEmailStatus,
} from "./client-email-validation.ts";
import {
  computeCompletenessScore,
  type OrganisationType,
  type StandardOrganisation,
} from "./standardize/types.ts";
import {
  validateWebsiteFormat,
  type WebsiteStatus,
} from "./website-validation.ts";

export const manualEntrySchema = z.object({
  legalName: z.string().trim().min(1, "Enter the organisation name.").max(200),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a two-letter country code."),
  website: z.string().trim().max(500).optional().or(z.literal("")),
  contactEmail: z.string().trim().max(320).optional().or(z.literal("")),
  registryName: z.string().trim().max(200).optional().or(z.literal("")),
  registryNumber: z.string().trim().max(200).optional().or(z.literal("")),
  reason: z.string().trim().min(10, "Explain why manual entry is needed (at least 10 characters).").max(2000),
});

export type ManualEntryInput = z.infer<typeof manualEntrySchema>;

export type ManualEntryIntegrationResult =
  | { status: "passed" }
  | { status: "blocked"; message: string };

export type ManualEntryCriteriaResult = Extract<
  ManualEntryIntegrationResult,
  { status: "passed" | "blocked" }
>;

export type ManualEntryCriteriaEvidence = Omit<ClientCriteriaInput, "organisationType"> & {
  organisationType?: string | null;
  /** Required when F047 identifies an ambiguous type that needs human review. */
  adminConfirmedEligible?: boolean;
};

export type ManualEntryFieldReview = {
  email: ClientEmailStatus;
  website: WebsiteStatus;
  warnings: string[];
};

/**
 * F045/F046 are field warnings, not record rejection rules. Calling this proves
 * both checks ran while preserving a useful manual submission when a value is bad.
 */
export function reviewManualEntryFields(
  input: ManualEntryInput,
  website: WebsiteStatus = validateWebsiteFormat(input.website),
): ManualEntryFieldReview {
  const email = validateClientEmail(input.contactEmail);
  const warnings = [
    ...(email.status === "invalid" ? [email.message] : []),
    ...(website.status === "invalid" || website.status === "unreachable"
      ? [website.message]
      : []),
  ];
  return { email, website, warnings };
}

/** Standard F041 organisation payload used by the F042-guarded approval flow. */
export function buildManualOrganisation(
  input: ManualEntryInput,
  organisationType: OrganisationType,
): StandardOrganisation {
  const email = validateClientEmail(input.contactEmail);
  const website = validateWebsiteFormat(input.website);
  const withoutScore: Omit<StandardOrganisation, "data_completeness_score"> = {
    legal_name: input.legalName.trim(),
    trading_name: "",
    country_code: input.countryCode.trim().toUpperCase(),
    is_international: input.countryCode.trim().toUpperCase() !== "GB",
    entry_method: "manual",
    is_verified: false,
    organisation_type: organisationType,
    website: website.status === "valid" ? website.url : input.website?.trim() ?? "",
    contact_email: email.status === "valid" ? email.value : input.contactEmail?.trim() ?? "",
    address_line_1: "",
    city: "",
    postcode: "",
    geographic_reach: null,
    outreach_status: "not_contacted",
    owner_id: null,
    is_seed: false,
  };
  return {
    ...withoutScore,
    data_completeness_score: computeCompletenessScore(withoutScore),
  };
}

export type ManualEntryApprovalChecks = {
  checkDuplicate(input: ManualEntryInput): Promise<ManualEntryIntegrationResult>;
};

/** Apply F047 to manual records without silently guessing a missing organisation type. */
export function checkManualEntryCriteria(
  evidence?: ManualEntryCriteriaEvidence,
): ManualEntryCriteriaResult {
  const organisationType = evidence?.organisationType?.trim();
  if (!organisationType) {
    return {
      status: "blocked",
      message: "Select or derive an organisation type before approving this manual entry.",
    };
  }

  const result = checkClientCriteria({ ...evidence, organisationType });
  if (result.outcome === "meets") return { status: "passed" };
  if (result.outcome === "needs_review") {
    return evidence?.adminConfirmedEligible
      ? { status: "passed" }
      : {
          status: "blocked",
          message: `F047 needs an admin eligibility decision: ${result.reasons.join(" ")}`,
        };
  }
  return {
    status: "blocked",
    message: `F047 does not meet the client criteria: ${result.reasons.join(" ")}`,
  };
}

/** Approval fails closed when F042 or F047 requires a human decision. */
export async function canApproveManualEntry(
  input: ManualEntryInput,
  checks: ManualEntryApprovalChecks,
  criteriaEvidence?: ManualEntryCriteriaEvidence,
): Promise<{ ok: true } | { ok: false; messages: string[] }> {
  const results = await Promise.all([
    checks.checkDuplicate(input),
    Promise.resolve(checkManualEntryCriteria(criteriaEvidence)),
  ]);
  const messages = results.flatMap((result) => {
    if (result.status === "passed") return [];
    return [result.message];
  });
  return messages.length === 0 ? { ok: true } : { ok: false, messages };
}
