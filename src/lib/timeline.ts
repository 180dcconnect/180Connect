/**
 * F075/F076 — merges four different row shapes (notes, outreach_messages,
 * reply_events, audit_log) into one chronological feed for the client detail
 * page, kept out of the route so it can be tested without a database (same
 * split as @/lib/client-basic-info).
 *
 * This is the first place in this codebase that merges genuinely different
 * tables into one sorted feed — @/lib/team-activity.ts and
 * @/lib/audit-log-format.ts are single-source formatters over audit_log, not
 * mergers, so there was no existing "merge N sources" utility to reuse.
 *
 * F076 (Timeline Event Types) has no schema/enum of its own anywhere in this
 * codebase — it is purely this file's TimelineEventType union, the label map,
 * and the style map below, invented here rather than found. "Final event type
 * list" (F076's own open question) is resolved by construction, not by
 * asking: every type below maps to a real, already-wired data source
 * (notes, outreach_messages, reply_events, or one of the four audit_log
 * actions this repo writes for a client) — there was nowhere to
 * invent a type with nothing behind it, and AC1's own "and similar" concedes
 * the list is not meant to be exhaustive forever.
 */

import { formatOutreachStatus } from "./organisation-format.ts";
import {
  isSensitiveOrgField,
  SENSITIVE_FIELD_LABELS,
} from "./edit-suggestions.ts";

export type TimelineEventType =
  | "email_sent"
  | "reply_received"
  | "note_added"
  | "note_edited"
  | "status_changed"
  | "ownership_reassigned"
  | "edit_applied"
  | "edit_rejected";

/** F076 AC1 — each entry labelled from this defined, finite set. */
export const TIMELINE_EVENT_LABEL: Record<TimelineEventType, string> = {
  email_sent: "Email sent",
  reply_received: "Reply received",
  note_added: "Note added",
  note_edited: "Note edited",
  status_changed: "Status changed",
  ownership_reassigned: "Ownership changed",
  edit_applied: "Suggested edit applied",
  edit_rejected: "Suggested edit rejected",
};

/**
 * The three tones this app's design system defines (docs/design-system.md), reused
 * rather than inventing new ones.
 */
export type TimelineTone = "brand" | "neutral" | "warn";

/**
 * How the event dot is drawn. Three states rather than the original two because
 * three tones × two fills could only distinguish six types and #80/#81 needed an
 * seventh and eighth: "ring" is the same hue again but drawn as a heavier border
 * over a faint tint instead of solid ink or a bare outline, so all eight pairings
 * stay visually distinct at a glance (F076 AC2).
 */
export type TimelineFill = "solid" | "hollow" | "ring";

export type TimelineStyle = {
  tone: TimelineTone;
  fill: TimelineFill;
};

export const TIMELINE_EVENT_STYLE: Record<TimelineEventType, TimelineStyle> = {
  email_sent: { tone: "brand", fill: "solid" },
  reply_received: { tone: "brand", fill: "hollow" },
  note_added: { tone: "neutral", fill: "solid" },
  note_edited: { tone: "neutral", fill: "hollow" },
  status_changed: { tone: "warn", fill: "solid" },
  ownership_reassigned: { tone: "warn", fill: "hollow" },
  edit_applied: { tone: "brand", fill: "ring" },
  edit_rejected: { tone: "warn", fill: "ring" },
};

export type TimelineEntry = {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  actorName: string;
  summary: string;
  /**
   * Only set for `ownership_reassigned` (F257 AC5) — the UI shows these as
   * distinct labelled fields (outgoing CAM, incoming CAM, reason), not folded
   * into `summary` alone, since AC4 asks for each to be identifiable on its
   * own, not just readable in a sentence.
   */
  handover?: { fromName: string; toName: string; reason: string };
};

/**
 * Shown for an actor who can't be identified — an account later deleted, or
 * (for `detail.from`/`detail.to`, which are bare uuids inside jsonb, not a
 * foreign key) a reference that was never one to begin with. Same phrasing
 * the owner fallback on this page already uses (page.tsx's `ownerName`,
 * visible-clients.ts), for consistency across the app (F257 AC5's "former
 * CAM" requirement).
 */
export const UNKNOWN_ACTOR = "A former team member";

export type NoteRow = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string | null;
  author: { full_name: string | null } | null;
};

export type OutreachMessageRow = {
  id: string;
  subject: string;
  send_status: "draft" | "scheduled" | "sent" | "failed";
  sent_at: string | null;
  sender: { full_name: string | null } | null;
};

export type ReplyEventRow = {
  id: string;
  reply_body: string;
  received_at: string;
};

export type AuditRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
};

/** `id` may be a real user id, or null (e.g. a "released" ownership's `to`). */
function resolveName(id: string | null, names: ReadonlyMap<string, string | null>): string {
  if (!id) return UNKNOWN_ACTOR;
  const name = names.get(id);
  return name && name.trim() ? name : UNKNOWN_ACTOR;
}

function detailString(detail: Record<string, unknown>, key: string): string | null {
  const value = detail[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * A note produces one entry when written, and a second at `updated_at` if it
 * has ever been edited (F073) — AC1 lists "notes added" and "edits made" as
 * separate things a CAM should see, and an edit made today belongs near
 * "today" in the timeline, not buried only under the note's original date.
 * There is no per-edit history to show a diff from (notes store no previous
 * content — F074's edit overwrites in place), so both entries show the note's
 * current content.
 */
export function buildNoteEntries(row: NoteRow): TimelineEntry[] {
  const authorName = row.author?.full_name?.trim();
  const actorName = authorName ? authorName : UNKNOWN_ACTOR;
  const entries: TimelineEntry[] = [
    {
      id: `note-added-${row.id}`,
      type: "note_added",
      timestamp: row.created_at,
      actorName,
      summary: row.content,
    },
  ];

  if (row.updated_at) {
    entries.push({
      id: `note-edited-${row.id}`,
      type: "note_edited",
      timestamp: row.updated_at,
      actorName,
      summary: row.content,
    });
  }

  return entries;
}

/**
 * Only an actually-delivered message is a timeline event — a draft or
 * scheduled-but-unsent one is not something that "happened" yet.
 */
export function buildEmailSentEntry(row: OutreachMessageRow): TimelineEntry | null {
  if (row.send_status !== "sent" || !row.sent_at) return null;
  const senderName = row.sender?.full_name?.trim();
  return {
    id: `email-${row.id}`,
    type: "email_sent",
    timestamp: row.sent_at,
    actorName: senderName ? senderName : UNKNOWN_ACTOR,
    summary: row.subject,
  };
}

/** A reply comes from the client, not a team member — there is no author to resolve. */
export function buildReplyReceivedEntry(row: ReplyEventRow): TimelineEntry {
  return {
    id: `reply-${row.id}`,
    type: "reply_received",
    timestamp: row.received_at,
    actorName: "The client",
    summary: row.reply_body,
  };
}

/**
 * set_outreach_status (20260807100000) writes `detail: {from, to}` with raw
 * pipeline-status tokens — formatOutreachStatus is the same formatter
 * StatusSelect already renders those tokens with, so the timeline reads the
 * same labels as the picker that produced the change.
 */
export function buildStatusChangedEntry(
  row: AuditRow,
  names: ReadonlyMap<string, string | null>,
): TimelineEntry {
  const from = detailString(row.detail, "from");
  const to = detailString(row.detail, "to");
  return {
    id: `status-${row.id}`,
    type: "status_changed",
    timestamp: row.created_at,
    actorName: resolveName(row.actor_user_id, names),
    summary: `Status changed from ${from ? formatOutreachStatus(from) : "—"} to ${
      to ? formatOutreachStatus(to) : "—"
    }.`,
  };
}

/**
 * reassign_ownership (20260804170000) writes `detail: {from, to, reason, ...}`
 * — `to` is absent/null for a released (unassigned) client, which reads as
 * "Unassigned" here rather than UNKNOWN_ACTOR: releasing ownership is a
 * deliberate act, not a person who left (F257 AC5).
 */
export function buildOwnershipReassignedEntry(
  row: AuditRow,
  names: ReadonlyMap<string, string | null>,
): TimelineEntry {
  const fromId = typeof row.detail.from === "string" ? row.detail.from : null;
  const toId = typeof row.detail.to === "string" ? row.detail.to : null;
  const fromName = resolveName(fromId, names);
  const toName = toId ? resolveName(toId, names) : "Unassigned";
  const reason = detailString(row.detail, "reason") ?? "No reason given";

  return {
    id: `ownership-${row.id}`,
    type: "ownership_reassigned",
    timestamp: row.created_at,
    actorName: resolveName(row.actor_user_id, names),
    summary: `Ownership moved from ${fromName} to ${toName}.`,
    handover: { fromName, toName, reason },
  };
}

/**
 * decide_edit_suggestion (20260822150000) writes `detail: {field, from, to,
 * requested_by, reason}` — the field is a raw ORGANISATIONS column name, so
 * SENSITIVE_FIELD_LABELS renders it the way the suggest-edit form named it. `to`
 * is only set on approval (nothing was written on rejection); `reason` only on
 * rejection.
 */
export function buildEditSuggestionEntry(
  row: AuditRow,
  names: ReadonlyMap<string, string | null>,
): TimelineEntry {
  const approved = row.action === "edit_suggestion_approved";
  const fieldKey = detailString(row.detail, "field");
  const fieldLabel =
    fieldKey && isSensitiveOrgField(fieldKey)
      ? SENSITIVE_FIELD_LABELS[fieldKey]
      : (fieldKey ?? "a field");
  const to = detailString(row.detail, "to");
  const reason = detailString(row.detail, "reason");
  const proposedBy = detailString(row.detail, "requested_by");
  const proposerName = proposedBy ? resolveName(proposedBy, names) : null;

  const summary = approved
    ? `Applied a suggested edit to ${fieldLabel}${to ? ` — now "${to}"` : ""}${
        proposerName ? ` (proposed by ${proposerName})` : ""
      }.`
    : `Declined a suggested edit to ${fieldLabel} — the record is unchanged.${
        reason ? ` Reason: ${reason}` : ""
      }`;

  return {
    id: `edit-suggestion-${row.id}`,
    type: approved ? "edit_applied" : "edit_rejected",
    timestamp: row.created_at,
    actorName: resolveName(row.actor_user_id, names),
    summary,
  };
}

export type TimelineSources = {
  notes: readonly NoteRow[];
  outreachMessages: readonly OutreachMessageRow[];
  replyEvents: readonly ReplyEventRow[];
  auditRows: readonly AuditRow[];
};

/**
 * Merges every source into one feed, newest first — the same order every
 * other list on this client page uses, for one consistent "chronological
 * order" across the page.
 *
 * F076 AC3 — an `auditRows` entry not matching a recognised `action` is
 * silently dropped, never turned into a generic "unlabelled" entry. Every
 * `TimelineEntry` this function can produce is built by one of the seven typed
 * functions above, each of which hardcodes a valid `TimelineEventType` — there
 * is no code path in this file that can construct an entry without one.
 */
export function buildTimeline(
  sources: TimelineSources,
  names: ReadonlyMap<string, string | null>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const row of sources.notes) entries.push(...buildNoteEntries(row));

  for (const row of sources.outreachMessages) {
    const entry = buildEmailSentEntry(row);
    if (entry) entries.push(entry);
  }

  for (const row of sources.replyEvents) entries.push(buildReplyReceivedEntry(row));

  for (const row of sources.auditRows) {
    if (row.action === "status_changed") {
      entries.push(buildStatusChangedEntry(row, names));
    } else if (row.action === "ownership_reassigned") {
      entries.push(buildOwnershipReassignedEntry(row, names));
    } else if (
      row.action === "edit_suggestion_approved" ||
      row.action === "edit_suggestion_rejected"
    ) {
      entries.push(buildEditSuggestionEntry(row, names));
    }
  }

  return entries.sort((a, b) =>
    a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
  );
}
