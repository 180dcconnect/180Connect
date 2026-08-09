import { z } from "zod";
import {
  checkClientCriteria,
  type ClientCriteriaInput,
} from "./client-criteria.ts";

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
  | { status: "blocked"; message: string }
  | { status: "not_available"; dependency: "F042" | "F046" };

export type ManualEntryCriteriaEvidence = Omit<ClientCriteriaInput, "organisationType"> & {
  organisationType?: string | null;
  /** Required when F047 identifies an ambiguous type that needs human review. */
  adminConfirmedEligible?: boolean;
};

export type ManualEntryApprovalChecks = {
  checkDuplicate(input: ManualEntryInput): Promise<ManualEntryIntegrationResult>;
  checkWebsite(input: ManualEntryInput): Promise<ManualEntryIntegrationResult>;
};

/** Apply F047 to manual records without silently guessing a missing organisation type. */
export function checkManualEntryCriteria(
  evidence?: ManualEntryCriteriaEvidence,
): ManualEntryIntegrationResult {
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

/** Approval must fail closed until every dependency has been connected. */
export async function canApproveManualEntry(
  input: ManualEntryInput,
  checks: ManualEntryApprovalChecks,
  criteriaEvidence?: ManualEntryCriteriaEvidence,
): Promise<{ ok: true } | { ok: false; messages: string[] }> {
  const results = await Promise.all([
    checks.checkDuplicate(input),
    checks.checkWebsite(input),
    Promise.resolve(checkManualEntryCriteria(criteriaEvidence)),
  ]);
  const messages = results.flatMap((result) => {
    if (result.status === "passed") return [];
    if (result.status === "blocked") return [result.message];
    return [`${result.dependency} integration is not available yet.`];
  });
  return messages.length === 0 ? { ok: true } : { ok: false, messages };
}
