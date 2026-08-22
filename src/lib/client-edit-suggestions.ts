/**
 * F077 — Suggest Client Edit.
 *
 * The formatting/decision logic behind the propose form and its client-profile
 * display, kept out of the route and the page so it can be tested without a
 * database (same split as @/lib/ownership-requests and @/lib/suppressions).
 *
 * suggest_client_edit (20260822090000) is the only write this file's callers
 * reach — it self-checks app.can_write(), snapshots the field's current value,
 * and moves nothing on ORGANISATIONS. Deciding a suggestion is F078/F079, not
 * yet built; there is deliberately no "approve"/"reject" helper here.
 */

import { FIELD_LABELS, FIELD_ORDER } from "./field-sources.ts";

export type ClientEditSuggestionStatus = "pending" | "approved" | "rejected";

export type ClientEditSuggestionRow = {
  id: string;
  field_name: string;
  current_value: string | null;
  proposed_value: string;
  status: ClientEditSuggestionStatus;
  note: string | null;
  created_at: string;
  suggested_by_user: { full_name: string | null } | null;
};

export type ClientEditSuggestion = {
  id: string;
  fieldName: string;
  fieldLabel: string;
  currentValue: string | null;
  proposedValue: string;
  status: ClientEditSuggestionStatus;
  note: string | null;
  createdAt: string;
  suggestedByName: string;
};

const UNKNOWN_SUGGESTER = "A former team member";

/**
 * Converts raw suggestion rows into display-ready entries, newest first.
 *
 * A row whose `field_name` falls outside the current six-field allowlist is
 * dropped rather than shown with a raw column name — defensive against a future
 * schema change the same way `formatOrganisationSources` is defensive against
 * malformed source rows.
 */
export function formatClientEditSuggestions(
  rows: readonly ClientEditSuggestionRow[],
): ClientEditSuggestion[] {
  return rows
    .filter((row) => row.field_name in FIELD_LABELS)
    .map((row) => ({
      id: row.id,
      fieldName: row.field_name,
      fieldLabel: FIELD_LABELS[row.field_name],
      currentValue: row.current_value,
      proposedValue: row.proposed_value,
      status: row.status,
      note: row.note,
      createdAt: row.created_at,
      suggestedByName: row.suggested_by_user?.full_name?.trim() || UNKNOWN_SUGGESTER,
    }))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

/**
 * Which of the six suggestible fields already have a suggestion awaiting a
 * decision — AC1/AC3: the propose form should not offer a second suggestion on
 * a field that already has one open, mirroring suggest_client_edit's own
 * `23505` guard so the UI doesn't invite a request the RPC will refuse.
 */
export function pendingSuggestionFields(
  suggestions: readonly ClientEditSuggestion[],
): ReadonlySet<string> {
  return new Set(
    suggestions.filter((suggestion) => suggestion.status === "pending").map((s) => s.fieldName),
  );
}

/** The six fields a CAM can propose a correction for, in the order the profile reads them. */
export const SUGGESTIBLE_FIELDS: readonly { fieldName: string; fieldLabel: string }[] =
  FIELD_ORDER.map((fieldName) => ({ fieldName, fieldLabel: FIELD_LABELS[fieldName] }));

export type RpcFailure = { status: number; error: string };

const GENERIC_FAILURE = "The suggestion could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from suggest_client_edit onto something safe to show a
 * user. Same shape and reasoning as ownershipRequestRpcFailure: every errcode
 * below is one the RPC raises deliberately with a message written to be read by
 * a CAM, not a developer; anything else gets the generic string.
 */
export function clientEditSuggestionRpcFailure(error: {
  code?: string;
  message?: string;
}): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "22023":
    case "23514":
      return { status: 400, error: error.message };
    case "23505":
    case "55000":
      return { status: 409, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: GENERIC_FAILURE };
  }
}
