/**
 * #79 (F077) — Suggest Client Edit.
 *
 * The decision logic behind the suggest-edit server action and the client-profile
 * section, kept out of the route so it can be tested without a database (same split
 * as @/lib/ownership-requests and @/lib/suppressions).
 *
 * The rule this file encodes, signed off with the Project Leader on #23: a CAM never
 * edits one of a client's six sensitive identity fields directly — proposing is the
 * only route, and it ends in an admin's decision (F078/F079). Nothing here changes
 * the live record; it only decides whether the *proposal* is offered and what it must
 * contain. The database holds the same line: suggest_organisation_edit re-checks
 * every guard in this file inside its SECURITY DEFINER body.
 */

import { z } from "zod";
import type { AppRole } from "./auth/permissions.ts";
import { nonEmptyTrimmed, safeValidate } from "./validation.ts";

/**
 * The sensitive fields — the only ones a suggestion can touch. Signed off on #23 and
 * deliberately identical to field_discrepancies/field_sources' allowlist
 * (20260815090000 / 20260820100000): externally verifiable identity/location fields
 * where a wrong value corrupts dedup and outreach targeting. The DB CHECK constraint
 * on edit_suggestions.field_name is this same list; change both together.
 */
export const SENSITIVE_ORG_FIELDS = [
  "legal_name",
  "website",
  "contact_email",
  "address_line_1",
  "city",
  "postcode",
] as const;

export type SensitiveOrgField = (typeof SENSITIVE_ORG_FIELDS)[number];

export function isSensitiveOrgField(value: string): value is SensitiveOrgField {
  return (SENSITIVE_ORG_FIELDS as readonly string[]).includes(value);
}

/** Reading labels for the UI. Keys mirror BasicInfoPanel's display names where they exist. */
export const SENSITIVE_FIELD_LABELS: Record<SensitiveOrgField, string> = {
  legal_name: "Name",
  website: "Website",
  contact_email: "Email",
  address_line_1: "Address line 1",
  city: "Town or city",
  postcode: "Postcode",
};

/**
 * Per-field validation, matching what manual entry already accepts for the same
 * columns (src/lib/manual-entry.ts): trimmed, bounded free text. website/contact_email
 * are NOT urlField/emailField here on purpose — canonical values arrive from messy
 * third-party sources and manual entry accepts the same shapes, so a CAM can propose
 * exactly what the record could hold.
 */
const FIELD_MAX_LENGTHS: Record<SensitiveOrgField, number> = {
  legal_name: 200,
  website: 500,
  contact_email: 320,
  address_line_1: 300,
  city: 200,
  postcode: 32,
};

function fieldValueSchema(field: SensitiveOrgField) {
  return z.object({
    fieldValue: nonEmptyTrimmed(
      FIELD_MAX_LENGTHS[field],
      `Enter the corrected ${SENSITIVE_FIELD_LABELS[field].toLowerCase()}.`,
    ),
  });
}

export type SuggestEditInput = {
  organisationId: string;
  fieldName: SensitiveOrgField;
  fieldValue: string;
};

/** Validates one suggest-edit submission; returns per-field errors like every form. */
export function validateSuggestEdit(input: {
  organisationId: unknown;
  fieldName: unknown;
  fieldValue: unknown;
}): { success: true; data: SuggestEditInput } | { success: false; message: string } {
  if (
    typeof input.organisationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(input.organisationId)
  ) {
    return { success: false, message: "This client could not be identified." };
  }

  if (typeof input.fieldName !== "string" || !isSensitiveOrgField(input.fieldName)) {
    return { success: false, message: "Choose a field to correct." };
  }

  const parsed = safeValidate(fieldValueSchema(input.fieldName), {
    fieldValue: input.fieldValue,
  });

  if (!parsed.success) {
    return { success: false, message: parsed.fieldErrors.fieldValue?.[0] ?? "Enter a value." };
  }

  return {
    success: true,
    data: {
      organisationId: input.organisationId,
      fieldName: input.fieldName,
      fieldValue: parsed.data.fieldValue,
    },
  };
}

// ---------------------------------------------------------------------------
// Submission state (server-action shape, mirrors ManualEntryState)
// ---------------------------------------------------------------------------

export type SuggestEditState = {
  kind: "idle" | "success" | "error";
  message: string;
  /** The field the state refers to, so the UI can scope success/error copy. */
  fieldName?: SensitiveOrgField;
};

export const idleSuggestEditState: SuggestEditState = { kind: "idle", message: "" };

// ---------------------------------------------------------------------------
// RPC failure mapping (same shape as ownershipRequestRpcFailure)
// ---------------------------------------------------------------------------

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE =
  "The suggested edit could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from suggest_organisation_edit onto something safe to show a
 * user. Every errcode below is one the RPC raises deliberately with a CAM-readable
 * message (see 20260822140000_create_edit_suggestions.sql); everything else gets the
 * generic string (DoD: no internals in a user-facing error).
 */
export function suggestEditRpcFailure(error: {
  code?: string;
  message?: string;
}): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "23514":
      return { status: 400, error: error.message };
    case "23505":
      // Unique-violation race: another pending suggestion landed between the RPC's
      // own check and the insert. The RPC's message reads fine as-is.
      return { status: 409, error: error.message };
    case "55000":
      return { status: 409, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}

// ---------------------------------------------------------------------------
// Availability + presentation
// ---------------------------------------------------------------------------

export type EditSuggestionStatus = "pending" | "approved" | "rejected" | "superseded";

export type PendingSuggestion = {
  id: string;
  field_name: string;
  current_value: string | null;
  proposed_value: string;
  requested_by: string;
};

export type SuggestEditAvailability =
  | { available: true }
  | {
      available: false;
      reason: "not_cam" | "field_blocked";
    };

/**
 * Whether the "Suggest edit" affordance should be offered for a field, and if not, why.
 *
 * Mirrors suggest_organisation_edit's own guards so the UI does not offer an action the
 * RPC will refuse. The RPC stays the enforcement point — this is presentation, and is
 * never the only thing standing between a CAM and a write.
 *
 * A pending proposal from ANOTHER CAM blocks the field (the RPC refuses with 23505);
 * the caller's OWN pending proposal does not — re-submitting supersedes it, which is
 * exactly what the RPC does, so the form stays open with a note.
 */
export function suggestEditAvailability({
  actorRole,
  actorId,
  fieldName,
  pendingSuggestions,
}: {
  actorRole: AppRole;
  actorId: string;
  fieldName: SensitiveOrgField;
  pendingSuggestions: PendingSuggestion[];
}): SuggestEditAvailability {
  // An admin edits these fields directly through the normal policy (matrix §3.2);
  // a viewer has no write access at all. Only a CAM proposes.
  if (actorRole !== "cam") return { available: false, reason: "not_cam" };

  const blocking = pendingSuggestions.find(
    (suggestion) => suggestion.field_name === fieldName,
  );
  if (blocking && blocking.requested_by !== actorId) {
    return { available: false, reason: "field_blocked" };
  }

  return { available: true };
}

/** What the team sees while a field has an open proposal. */
export function pendingSuggestionNotice(fieldName: SensitiveOrgField): string {
  return `A correction to ${SENSITIVE_FIELD_LABELS[fieldName]} is awaiting admin review — the value below is still the live one.`;
}

// ---------------------------------------------------------------------------
// Admin queue + decisions (#80/#81, F078/F079)
// ---------------------------------------------------------------------------

/** Full row shape behind the admin queue and the client-profile decision cards.
 *  Joins mirror OWNERSHIP_REQUEST_SELECT's alias style. */
export type EditSuggestionRow = {
  id: string;
  organisation_id: string;
  field_name: string;
  current_value: string | null;
  proposed_value: string;
  status: EditSuggestionStatus;
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  organisations: { legal_name: string } | null;
  requested_by_user: { full_name: string | null; email: string } | null;
  decided_by_user: { full_name: string | null; email: string } | null;
};

/** Shared PostgREST select for the admin page's initial load and the GET route. */
export const EDIT_SUGGESTION_SELECT = `
  id, organisation_id, field_name, current_value, proposed_value, status,
  requested_by, decided_by, decided_at, rejection_reason, created_at,
  organisations ( legal_name ),
  requested_by_user:users!edit_suggestions_requested_by_fkey ( full_name, email ),
  decided_by_user:users!edit_suggestions_decided_by_fkey ( full_name, email )
`;

const DECIDE_GENERIC_FAILURE =
  "The decision could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from decide_edit_suggestion onto something safe to show an
 * admin. Every errcode below is one the RPC raises deliberately with an admin-readable
 * message (see 20260822150000_create_decide_edit_suggestion_rpc.sql).
 */
export function decideEditRpcFailure(error: {
  code?: string;
  message?: string;
}): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: DECIDE_GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "55000":
      return { status: 409, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: DECIDE_GENERIC_FAILURE };
  }
}

/**
 * What the submitting CAM is told about a suggestion that has been decided — AC3 of
 * F078 ("notification or a visible status"): the suggest-edit card renders this next
 * to their own rows, so nobody waits on an answer that already happened.
 */
export function suggestionDecisionNotice(
  status: Exclude<EditSuggestionStatus, "pending" | "superseded">,
  fieldNameLabel: string,
  rejectionReason?: string | null,
): string {
  const head =
    status === "approved"
      ? `An admin approved your correction to ${fieldNameLabel}. The live record now carries it.`
      : `An admin declined your correction to ${fieldNameLabel}. The live record is unchanged.`;
  const reason = rejectionReason?.trim();
  return reason ? `${head} Reason: ${reason}` : head;
}

/** One line summarising a pending proposal, reused by both admin surfaces. */
export function describePendingSuggestion(
  fieldNameLabel: string,
  currentValue: string | null,
  proposedValue: string,
): string {
  const current = currentValue?.trim() || "Not provided";
  return `${fieldNameLabel}: "${current}" → "${proposedValue}"`;
}
