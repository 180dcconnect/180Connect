/**
 * F186 — View Client Change History. Turns the audit_log rows that record
 * changes to a client's record into one admin-facing feed of field-level
 * changes, kept out of the route so it can be tested without a database (same
 * split as @/lib/timeline.ts).
 *
 * This is NOT the timeline (@/lib/timeline.ts) and deliberately does not reuse
 * its entry builders:
 *
 *   - The timeline is every active role's story of "what happened" — emails,
 *     replies, notes, plus the four audit actions RLS exposes to non-admins.
 *   - This is an admin's audit of "what changed on the record and who changed
 *     it", so it includes the two field_discrepancy_* actions only admins can
 *     read (audit_log_select_admin, 20260723100000) and renders each change as
 *     structured from → to data rather than a sentence.
 *
 * The actions listed here are exactly what the write paths actually record for
 * target_table = 'organisations' today:
 *
 *   edit_suggestion_approved / _rejected  decide_edit_suggestion (20260822160200)
 *                                         detail: {suggestion_id, field, from,
 *                                         to, requested_by, reason}
 *   status_changed                        set_outreach_status (20260807100000)
 *                                         detail: {from, to}
 *   ownership_reassigned                  reassign/claim/offboard RPCs
 *                                         detail: {from, to, reason?, trigger?}
 *   field_discrepancy_resolved            resolve_field_discrepancy
 *   field_discrepancy_auto_resolved       (both 20260815090000)
 *                                         detail: {field_name, choice, value,
 *                                         note | sources}
 *
 * Deliberately excluded: suppression, status-flag and manual-entry actions.
 * Those are workflow events about a client, not changes to the client's
 * record; add them here only if F186's scope grows to want them.
 */

import { restrictedFieldLabel } from "./edit-suggestions.ts";
import { formatOutreachStatus } from "./organisation-format.ts";
import { UNKNOWN_ACTOR } from "./timeline.ts";

/** The audit_log action tokens this feed renders. The page queries `.in()` this list. */
export const CHANGE_HISTORY_ACTIONS = [
  "edit_suggestion_approved",
  "edit_suggestion_rejected",
  "status_changed",
  "ownership_reassigned",
  "field_discrepancy_resolved",
  "field_discrepancy_auto_resolved",
] as const;

export type ChangeHistoryAction = (typeof CHANGE_HISTORY_ACTIONS)[number];

export const CHANGE_HISTORY_ACTION_LABEL: Record<ChangeHistoryAction, string> = {
  edit_suggestion_approved: "Suggested edit applied",
  edit_suggestion_rejected: "Suggested edit rejected",
  status_changed: "Pipeline status changed",
  ownership_reassigned: "Ownership changed",
  field_discrepancy_resolved: "Field discrepancy resolved",
  field_discrepancy_auto_resolved: "Discrepancy auto-resolved",
};

export type ChangeHistoryRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export type ChangeHistoryEntry = {
  id: string;
  /** Raw audit token, for keys/tests. */
  action: ChangeHistoryAction;
  label: string;
  /** Which column changed, spelled the way the suggest-edit form names it. */
  fieldLabel: string | null;
  /** What the column said before and after, already formatted for reading. */
  from: string | null;
  to: string | null;
  /**
   * Whether the change was applied to the record. False only ever means a
   * rejected suggestion — recorded in the trail even though nothing was
   * written (the proposer and the reason are data-quality signal). Null for
   * actions where the question does not arise.
   */
  applied: boolean | null;
  /** Rejection reason, resolution note or handover reason, if any. */
  note: string | null;
  actorName: string;
  timestamp: string;
};

function detailString(detail: Record<string, unknown>, key: string): string | null {
  const value = detail[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function resolveName(id: string | null, names: ReadonlyMap<string, string | null>): string {
  if (!id) return UNKNOWN_ACTOR;
  const name = names.get(id);
  return name && name.trim() ? name : UNKNOWN_ACTOR;
}

/**
 * decide_edit_suggestion keys the changed column "field"; the discrepancy
 * resolvers key it "field_name". Both mean the same thing — normalise here so
 * no caller ever has to know which RPC wrote a row.
 */
function fieldNameOf(detail: Record<string, unknown>): string | null {
  return detailString(detail, "field") ?? detailString(detail, "field_name");
}

function buildEditSuggestionEntry(
  row: ChangeHistoryRow,
  names: ReadonlyMap<string, string | null>,
): ChangeHistoryEntry {
  const approved = row.action === "edit_suggestion_approved";
  const fieldKey = fieldNameOf(row.detail);
  return {
    id: row.id,
    action: row.action as ChangeHistoryAction,
    label: CHANGE_HISTORY_ACTION_LABEL[row.action as ChangeHistoryAction],
    fieldLabel: fieldKey ? restrictedFieldLabel(fieldKey) : null,
    from: detailString(row.detail, "from"),
    // Nothing was written on rejection — `to` stays empty rather than being
    // padded with a dash, so the entry reads as "proposed X, declined".
    to: approved ? detailString(row.detail, "to") : null,
    applied: approved,
    note: detailString(row.detail, "reason"),
    actorName: resolveName(row.actor_user_id, names),
    timestamp: row.created_at,
  };
}

function buildStatusChangedEntry(
  row: ChangeHistoryRow,
  names: ReadonlyMap<string, string | null>,
): ChangeHistoryEntry {
  const from = detailString(row.detail, "from");
  const to = detailString(row.detail, "to");
  return {
    id: row.id,
    action: "status_changed",
    label: CHANGE_HISTORY_ACTION_LABEL.status_changed,
    fieldLabel: null,
    from: from ? formatOutreachStatus(from) : null,
    to: to ? formatOutreachStatus(to) : null,
    applied: null,
    note: null,
    actorName: resolveName(row.actor_user_id, names),
    timestamp: row.created_at,
  };
}

function buildOwnershipReassignedEntry(
  row: ChangeHistoryRow,
  names: ReadonlyMap<string, string | null>,
): ChangeHistoryEntry {
  const fromId = detailString(row.detail, "from");
  const toId = detailString(row.detail, "to");
  // A released client has no incoming owner by design, not by deletion.
  const toName = toId ? resolveName(toId, names) : "Unassigned";
  return {
    id: row.id,
    action: "ownership_reassigned",
    label: CHANGE_HISTORY_ACTION_LABEL.ownership_reassigned,
    fieldLabel: null,
    from: fromId ? resolveName(fromId, names) : null,
    to: toName,
    applied: null,
    note: detailString(row.detail, "reason"),
    actorName: resolveName(row.actor_user_id, names),
    timestamp: row.created_at,
  };
}

function buildDiscrepancyEntry(
  row: ChangeHistoryRow,
  names: ReadonlyMap<string, string | null>,
): ChangeHistoryEntry {
  const auto = row.action === "field_discrepancy_auto_resolved";
  let note = detailString(row.detail, "note");
  if (!note && auto) {
    const existing = detailString(row.detail, "existing_source");
    const incoming = detailString(row.detail, "incoming_source");
    note =
      existing || incoming
        ? `Settled by source priority${existing ? `: kept ${existing}` : ""}${
            incoming ? ` over ${incoming}` : ""
          }.`
        : "Settled automatically by source priority.";
  }
  return {
    id: row.id,
    action: row.action as ChangeHistoryAction,
    label: CHANGE_HISTORY_ACTION_LABEL[row.action as ChangeHistoryAction],
    fieldLabel: (() => {
      const fieldKey = fieldNameOf(row.detail);
      return fieldKey ? restrictedFieldLabel(fieldKey) : null;
    })(),
    from: null,
    // The resolver records which value won (`value`), not what it replaced —
    // the losing value lives in FIELD_DISCREPANCIES, not in this row.
    to: detailString(row.detail, "value"),
    applied: true,
    note,
    actorName: resolveName(row.actor_user_id, names),
    timestamp: row.created_at,
  };
}

/**
 * Builds the newest-first change history from raw audit_log rows. Rows whose
 * action is outside CHANGE_HISTORY_ACTIONS are skipped rather than rendered as
 * generics — an unrecognised token would promise structure this module cannot
 * fill, and new actions should be added to the map explicitly.
 */
export function buildChangeHistory(
  rows: readonly ChangeHistoryRow[],
  names: ReadonlyMap<string, string | null>,
): ChangeHistoryEntry[] {
  const entries: ChangeHistoryEntry[] = [];
  for (const row of rows) {
    switch (row.action) {
      case "edit_suggestion_approved":
      case "edit_suggestion_rejected":
        entries.push(buildEditSuggestionEntry(row, names));
        break;
      case "status_changed":
        entries.push(buildStatusChangedEntry(row, names));
        break;
      case "ownership_reassigned":
        entries.push(buildOwnershipReassignedEntry(row, names));
        break;
      case "field_discrepancy_resolved":
      case "field_discrepancy_auto_resolved":
        entries.push(buildDiscrepancyEntry(row, names));
        break;
      default:
        break;
    }
  }
  return entries.sort((a, b) =>
    a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
  );
}
