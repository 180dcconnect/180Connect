/**
 * #79/#80/#81 + #23 (F077/F078/F079/F020) — Restricted Editing.
 *
 * The decision logic behind the suggest-edit server action, the client-profile
 * section and the admin configuration panel, kept out of the routes so it can be
 * tested without a database (same split as @/lib/ownership-requests).
 *
 * The rule this file encodes, signed off with the Project Leader on #23: a CAM never
 * edits a restricted client field directly — proposing is the only route, and it ends
 * in an admin's decision (F078/F079). Nothing here changes the live record; it only
 * decides whether the *proposal* is offered and what it must contain. The database
 * holds the same line twice over: suggest_organisation_edit re-checks every guard in
 * this file inside its SECURITY DEFINER body, and the organisations column-guard
 * trigger blocks any direct write the UI might miss.
 *
 * Since F020 the restricted set itself is data (RESTRICTED_EDIT_FIELDS, managed by
 * admins at runtime), not this constant — SENSITIVE_ORG_FIELDS is the seeded default,
 * its labels, and the type-level floor every other module can rely on.
 */

import { z } from "zod";
import type { AppRole } from "./auth/permissions.ts";
import { nonEmptyTrimmed, safeValidate } from "./validation.ts";

/**
 * The seeded restricted fields (#23, signed off 22 Aug 2026): the externally
 * verifiable identity/location fields where a wrong value corrupts dedup and
 * outreach targeting. F020 made this list runtime-configurable — the live set is
 * RESTRICTED_EDIT_FIELDS in the database, read by the pages that need it. This
 * constant remains as (a) the seed's mirror for tests and docs and (b) the label
 * map below; new restricted fields get a derived label via restrictedFieldLabel.
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
 * Label for any restricted field, known or admin-added: the curated display name for
 * the seeded six, otherwise the column name with underscores spaced out. A field an
 * admin adds later has no hand-written label anywhere, so this is the one place the
 * UI can go.
 */
export function restrictedFieldLabel(fieldName: string): string {
  return isSensitiveOrgField(fieldName)
    ? SENSITIVE_FIELD_LABELS[fieldName]
    : fieldName.replaceAll("_", " ");
}

/**
 * Per-field validation, matching what manual entry already accepts for the same
 * columns (src/lib/manual-entry.ts): trimmed, bounded free text. website/contact_email
 * are NOT urlField/emailField here on purpose — canonical values arrive from messy
 * third-party sources and manual entry accepts the same shapes, so a CAM can propose
 * exactly what the record could hold. Fields added after seeding have no recorded
 * length bound; they get a generous default.
 */
const FIELD_MAX_LENGTHS: Record<SensitiveOrgField, number> = {
  legal_name: 200,
  website: 500,
  contact_email: 320,
  address_line_1: 300,
  city: 200,
  postcode: 32,
};

const DEFAULT_FIELD_MAX_LENGTH = 500;

function maxLengthFor(field: string): number {
  return isSensitiveOrgField(field) ? FIELD_MAX_LENGTHS[field] : DEFAULT_FIELD_MAX_LENGTH;
}

function fieldValueSchema(field: string) {
  return z.object({
    fieldValue: nonEmptyTrimmed(
      maxLengthFor(field),
      `Enter the corrected ${restrictedFieldLabel(field).toLowerCase()}.`,
    ),
  });
}

export type SuggestEditInput = {
  organisationId: string;
  fieldName: string;
  fieldValue: string;
};

/**
 * Validates one suggest-edit submission; returns per-field errors like every form.
 *
 * allowedFields is the live RESTRICTED_EDIT_FIELDS list the caller fetched — the UI
 * only offers those fields, and this check keeps the action honest against a forged
 * formData. It defaults to the seeded six so pure-form callers stay correct without
 * a database round-trip; the RPC re-checks the live table regardless.
 */
export function validateSuggestEdit(input: {
  organisationId: unknown;
  fieldName: unknown;
  fieldValue: unknown;
  allowedFields?: readonly string[];
}): { success: true; data: SuggestEditInput } | { success: false; message: string } {
  if (
    typeof input.organisationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(input.organisationId)
  ) {
    return { success: false, message: "This client could not be identified." };
  }

  const allowedFields = input.allowedFields ?? SENSITIVE_ORG_FIELDS;
  if (
    typeof input.fieldName !== "string" ||
    !allowedFields.includes(input.fieldName)
  ) {
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
  fieldName?: string;
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
  fieldName: string;
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
export function pendingSuggestionNotice(fieldName: string): string {
  return `A correction to ${restrictedFieldLabel(fieldName)} is awaiting admin review — the value below is still the live one.`;
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
 * message (see 20260822150500_create_decide_edit_suggestion_rpc.sql).
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

// ---------------------------------------------------------------------------
// Restricted-field configuration (#23, F020)
// ---------------------------------------------------------------------------

/** Row shape behind the admin configuration panel. */
export type RestrictedFieldRow = {
  field_name: string;
  reason: string;
  active: boolean;
};

/**
 * Validates one add-restriction submission. The field name must look like a Postgres
 * column (the RPC re-checks it against organisations' actual text columns — this is
 * the cheap first pass so obvious junk never leaves the form).
 */
export function validateRestrictedFieldInput(input: {
  fieldName: unknown;
  reason: unknown;
}): { success: true; data: { fieldName: string; reason: string } } | { success: false; message: string } {
  if (
    typeof input.fieldName !== "string" ||
    !/^[a-z][a-z0-9_]*$/.test(input.fieldName.trim())
  ) {
    return {
      success: false,
      message: "Enter the column name of a client field, e.g. trading_name.",
    };
  }

  const parsed = safeValidate(
    z.object({ reason: nonEmptyTrimmed(500, "Say why this field is being restricted.") }),
    { reason: input.reason },
  );
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.fieldErrors.reason?.[0] ?? "Say why this field is being restricted.",
    };
  }

  return {
    success: true,
    data: { fieldName: input.fieldName.trim(), reason: parsed.data.reason },
  };
}

const CONFIG_GENERIC_FAILURE =
  "The change could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from add_restricted_edit_field /
 * deactivate_restricted_edit_field onto something safe to show an admin. Every
 * errcode below is one the RPCs raise deliberately (see
 * 20260822160000_create_restricted_edit_fields.sql); anything else gets the generic
 * string.
 */
export function restrictedFieldRpcFailure(error: {
  code?: string;
  message?: string;
}): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: CONFIG_GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "23514":
      return { status: 400, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: CONFIG_GENERIC_FAILURE };
  }
}
