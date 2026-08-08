import { z } from "zod";

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
  | { status: "not_available"; dependency: "F042" | "F046" | "F047" };

export type ManualEntryApprovalChecks = {
  checkDuplicate(input: ManualEntryInput): Promise<ManualEntryIntegrationResult>;
  checkWebsite(input: ManualEntryInput): Promise<ManualEntryIntegrationResult>;
  checkCriteria(input: ManualEntryInput): Promise<ManualEntryIntegrationResult>;
};

/** Approval must fail closed until every dependency has been connected. */
export async function canApproveManualEntry(
  input: ManualEntryInput,
  checks: ManualEntryApprovalChecks,
): Promise<{ ok: true } | { ok: false; messages: string[] }> {
  const results = await Promise.all([
    checks.checkDuplicate(input),
    checks.checkWebsite(input),
    checks.checkCriteria(input),
  ]);
  const messages = results.flatMap((result) => {
    if (result.status === "passed") return [];
    if (result.status === "blocked") return [result.message];
    return [`${result.dependency} integration is not available yet.`];
  });
  return messages.length === 0 ? { ok: true } : { ok: false, messages };
}
