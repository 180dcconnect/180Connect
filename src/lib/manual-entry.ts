import { z } from "zod";
import {
  checkClientCriteria,
  type ClientCriteriaInput,
} from "./client-criteria.ts";
import {
  validateClientEmail,
  type ClientEmailStatus,
} from "./client-email-validation.ts";
import { normalizeCity } from "./city.ts";
import {
  computeCompletenessScore,
  type OrganisationType,
  type StandardOrganisation,
} from "./standardize/types.ts";
import {
  validateWebsiteFormat,
  type WebsiteStatus,
} from "./website-validation.ts";

const organisationTypeSchema = z.enum([
  "charity",
  "cio",
  "cic",
  "social_enterprise",
  "ngo",
  "company",
  "both",
  "other",
]);

/**
 * Sector, reach and size — optional on both the draft and the submission.
 *
 * Numbers arrive from FormData as strings, so they are checked as whole-number
 * strings here and converted in the action. A size figure needs the accounts
 * year end it belongs to: the database files them as one financial period, and a
 * period has to end somewhere (20261002090000).
 */
const wholeNumberText = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{0,12}$/, `${label} must be a whole number.`);

// `.optional()` on each: these are extras, so every existing caller of the
// schemas (field review, criteria checks, their tests) stays valid without them.
const sizeAndFocusFields = {
  sector: z.string().trim().max(100).optional(),
  geographicReach: z.enum(["local", "regional", "national", "international"]).or(z.literal("")).optional(),
  latestIncome: wholeNumberText("Annual income").optional(),
  accountsYearEnd: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Enter the accounts year end as a date.")
    .optional(),
  staffCount: wholeNumberText("Staff").optional(),
  volunteerCount: wholeNumberText("Volunteers").optional(),
};

/** The fields the year-end rule reads — all optional, like the schema's. */
type SizeAndFocus = {
  latestIncome?: string;
  accountsYearEnd?: string;
  staffCount?: string;
  volunteerCount?: string;
};

function sizeNeedsYearEnd(value: SizeAndFocus, ctx: z.RefinementCtx) {
  if ((value.latestIncome || value.staffCount || value.volunteerCount) && !value.accountsYearEnd) {
    ctx.addIssue({
      code: "custom",
      path: ["accountsYearEnd"],
      message: "Add the accounts year end those figures are from.",
    });
  }
  if (value.accountsYearEnd && value.accountsYearEnd > new Date().toISOString().slice(0, 10)) {
    ctx.addIssue({
      code: "custom",
      path: ["accountsYearEnd"],
      message: "The accounts year end cannot be in the future.",
    });
  }
}

export const manualEntryDraftSchema = z.object({
  legalName: z.string().trim().max(200),
  missionStatement: z.string().trim().max(5000),
  organisationType: organisationTypeSchema.optional().or(z.literal("")),
  addressLine1: z.string().trim().max(300),
  city: z.string().trim().max(200),
  postcode: z.string().trim().max(32),
  countryCode: z.string().trim().toUpperCase().max(2),
  website: z.string().trim().max(500),
  contactEmail: z.string().trim().max(320),
  registryName: z.string().trim().max(200),
  registryNumber: z.string().trim().max(200),
  reason: z.string().trim().max(2000),
  ...sizeAndFocusFields,
}).superRefine(sizeNeedsYearEnd);

export const manualEntrySchema = z.object({
  legalName: z.string().trim().min(1, "Enter the organisation name.").max(200),
  missionStatement: z.string().trim().min(1, "Enter the organisation mission.").max(5000),
  organisationType: organisationTypeSchema,
  addressLine1: z.string().trim().min(1, "Enter the first address line.").max(300),
  city: z.string().trim().min(1, "Enter the town or city.").max(200),
  postcode: z.string().trim().min(1, "Enter the postcode or postal code.").max(32),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a two-letter country code."),
  website: z.string().trim().min(1, "Enter the organisation website.").max(500),
  contactEmail: z.string().trim().min(1, "Enter the contact email.").max(320),
  registryName: z.string().trim().min(1, "Enter the registry name.").max(200),
  registryNumber: z.string().trim().min(1, "Enter the registry number.").max(200),
  reason: z.string().trim().min(10, "Explain why manual entry is needed (at least 10 characters).").max(2000),
  ...sizeAndFocusFields,
}).superRefine(sizeNeedsYearEnd);

export type ManualEntryInput = z.infer<typeof manualEntrySchema>;
export type ManualEntryDraftInput = z.infer<typeof manualEntryDraftSchema>;

const MANUAL_ENTRY_SCHEMA_ERROR_CODES = new Set([
  "42P01", // PostgreSQL: undefined table
  "42703", // PostgreSQL: undefined column (an older F036 migration is applied)
  "PGRST204", // PostgREST: selected column is absent from the schema cache
  "PGRST205", // PostgREST: table is absent from the schema cache
]);

/**
 * Keep production failures safe while making a stale local review database
 * actionable. The full Supabase error is still sent through reportError.
 */
export function manualDraftLoadErrorMessage(
  error: unknown,
  isDevelopment: boolean,
): string {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";

  if (isDevelopment && MANUAL_ENTRY_SCHEMA_ERROR_CODES.has(code)) {
    return "Your local database is missing the latest Manual Entry migration. Run npx supabase db reset, then reload this page.";
  }

  return "Saved drafts could not be loaded. The failure was recorded; you can still start a new entry.";
}

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
    organisation_type: input.organisationType as OrganisationType,
    website: website.status === "valid" ? website.url : input.website?.trim() ?? "",
    contact_email: email.status === "valid" ? email.value : input.contactEmail?.trim() ?? "",
    address_line_1: input.addressLine1.trim(),
    city: normalizeCity(input.city.trim()),
    postcode: input.postcode.trim(),
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

/**
 * Full row shape behind the admin review queue. Joins mirror the
 * EDIT_SUGGESTION_SELECT alias style; FK hint names are Postgres's own
 * auto-names for the inline references in
 * 20260817130000_create_manual_entry_records.sql.
 */
export type ManualEntryReviewRow = {
  id: string;
  legal_name: string;
  mission_statement: string;
  organisation_type: "charity" | "cio" | "cic" | "social_enterprise" | "ngo" | "company" | "both" | "other";
  address_line_1: string;
  city: string;
  postcode: string;
  country_code: string;
  website: string | null;
  contact_email: string | null;
  contact_email_role_confirmed_for: string | null;
  contact_email_role_confirmed_at: string | null;
  role_confirmer: { full_name: string | null } | { full_name: string | null }[] | null;
  registry_name: string | null;
  registry_number: string | null;
  /** The register's second number, when the charity is also a company (20261005120000). */
  company_number: string | null;
  reason_for_manual_entry: string;
  sector: string | null;
  geographic_reach: string | null;
  latest_income: number | null;
  accounts_year_end: string | null;
  staff_count: number | null;
  volunteer_count: number | null;
  review_status: string;
  created_at: string;
  converted_to_organisation_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  submitter: { full_name: string | null } | { full_name: string | null }[] | null;
  reviewed_by: { full_name: string | null } | { full_name: string | null }[] | null;
};

/** Shared PostgREST select for the approvals page's manual-entry queue. */
export const MANUAL_ENTRY_REVIEW_SELECT = `
  id, legal_name, mission_statement, organisation_type, address_line_1, city, postcode,
  country_code, website, contact_email, contact_email_role_confirmed_for,
  contact_email_role_confirmed_at,
  role_confirmer:users!manual_entry_records_contact_email_role_confirmed_by_fkey ( full_name ),
  registry_name, registry_number, company_number, reason_for_manual_entry, sector,
  geographic_reach, latest_income, accounts_year_end, staff_count, volunteer_count,
  review_status, created_at, converted_to_organisation_id, reviewed_at, review_notes,
  submitter:users!manual_entry_records_submitted_by_user_id_fkey ( full_name ),
  reviewed_by:users!manual_entry_records_reviewed_by_user_id_fkey ( full_name )
`;

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
