/**
 * Turns an `audit_log` row into something a person can read.
 *
 * The table stores machine tokens on purpose — `invite_cancelled`,
 * `role_change_denied` — because the trail has to stay stable and greppable no
 * matter how the UI copy changes (docs/audit-log-pattern.md §3 requires past-tense
 * snake_case). This module is the one place that translates them, so the page
 * itself never contains a string like "Invite cancelled".
 *
 * Everything here is pure and formatted **on the server**: the page is uncached
 * and dynamic, and a relative time computed in the browser would disagree with
 * the SSR output and trip a hydration mismatch. The component receives finished
 * strings.
 *
 * An action with no entry below still renders — it falls back to a humanised
 * token — so a future RPC that follows the pattern shows up here on the day it
 * ships, without this file being touched. Adding an entry only improves the copy.
 */

import { formatOutreachStatus } from "./organisation-format.ts";
import {
  dayKeyOf,
  formatDayLabel,
  formatExactTime,
  formatRelativeTime,
  humaniseToken,
} from "./display-format.ts";

// Re-exported so the module stays the one import an audit-log caller needs,
// even though the generic half now lives with the other shared formatting.
export { groupByDay, humaniseToken } from "./display-format.ts";

/**
 * How loud a row is allowed to be. The design system permits exactly one accent
 * per screen, so these are used on the icon disc only — never as a row
 * background, which would turn a hundred-row list into a heat map.
 */
export type AuditTone = "neutral" | "positive" | "caution";

/**
 * Names an icon rather than importing one, the same way `SidebarNavItem` does —
 * this module stays pure and node-testable, and the rail of glyphs is drawn in
 * one place in the component.
 */
export type AuditIconName =
  | "role"
  | "access"
  | "ownership"
  | "pipeline"
  | "suppression"
  | "flag"
  | "quality"
  | "invite"
  | "duplicate"
  | "blocked"
  | "generic";

type ActionSpec = {
  /** Noun phrase for the badge: "Role changed". */
  label: string;
  /**
   * Verb phrase that completes "{Actor} …". Ends open so the target's name
   * closes the sentence: "changed the role of" + "Mohammed Saeed".
   * Omit for actions that have no readable target to point at.
   */
  verb?: string;
  /**
   * A `detail` key that names the thing acted on, for when the row itself
   * cannot. Cancelling an invite deletes the account, so `target_id` points at
   * a row that no longer exists by the time anyone reads the trail — and
   * `detail.email` is the only thing left that says who it was. The key is
   * spent on the sentence and not repeated as a chip.
   */
  objectKey?: string;
  tone: AuditTone;
  icon: AuditIconName;
};

/**
 * Every action token this app currently writes, gathered from the RPCs in
 * `supabase/migrations/` and the two direct writers the audit table's own
 * migration names as legitimate (`src/lib/auth/invite.ts`,
 * `src/lib/auth/permission-denial.ts`).
 */
export const AUDIT_ACTIONS: Record<string, ActionSpec> = {
  role_changed: { label: "Role changed", verb: "changed the role of", tone: "neutral", icon: "role" },
  role_change_denied: {
    label: "Role change blocked",
    verb: "was blocked from changing the role of",
    tone: "caution",
    icon: "blocked",
  },

  user_suspended: { label: "Account suspended", verb: "suspended", tone: "caution", icon: "access" },
  user_reactivated: { label: "Account reactivated", verb: "reactivated", tone: "positive", icon: "access" },
  user_deactivated: { label: "Account deactivated", verb: "deactivated", tone: "caution", icon: "access" },

  invite_accepted: {
    label: "Invite accepted",
    verb: "accepted the invite for",
    objectKey: "email",
    tone: "positive",
    icon: "invite",
  },
  invite_cancelled: {
    label: "Invite cancelled",
    verb: "cancelled the invite for",
    objectKey: "email",
    tone: "caution",
    icon: "invite",
  },

  ownership_assigned: { label: "Owner assigned", verb: "assigned ownership of", tone: "neutral", icon: "ownership" },
  ownership_reassigned: {
    label: "Owner changed",
    verb: "reassigned ownership of",
    tone: "neutral",
    icon: "ownership",
  },
  action_reassigned: { label: "Task reassigned", verb: "reassigned a task on", tone: "neutral", icon: "ownership" },
  actions_moved: { label: "Tasks moved", verb: "moved the open tasks of", tone: "neutral", icon: "ownership" },

  status_changed: { label: "Pipeline status changed", verb: "moved", tone: "neutral", icon: "pipeline" },

  edit_suggestion_approved: {
    label: "Suggested edit approved",
    verb: "approved a suggested edit on",
    tone: "positive",
    icon: "quality",
  },
  edit_suggestion_rejected: {
    label: "Suggested edit rejected",
    verb: "rejected a suggested edit on",
    tone: "neutral",
    icon: "quality",
  },

  suppression_requested: {
    label: "Suppression requested",
    verb: "requested suppression of",
    tone: "caution",
    icon: "suppression",
  },
  suppression_approved: {
    label: "Suppression approved",
    verb: "approved the suppression of",
    tone: "caution",
    icon: "suppression",
  },
  suppression_rejected: {
    label: "Suppression rejected",
    verb: "rejected the suppression of",
    tone: "positive",
    icon: "suppression",
  },
  suppression_lifted: {
    label: "Suppression lifted",
    verb: "lifted the suppression of",
    tone: "positive",
    icon: "suppression",
  },

  organisation_status_flagged: { label: "Flag raised", verb: "flagged", tone: "caution", icon: "flag" },
  organisation_status_flag_acknowledged: {
    label: "Flag acknowledged",
    verb: "acknowledged a flag on",
    tone: "positive",
    icon: "flag",
  },

  data_quality_event_resolved: {
    label: "Data issue resolved",
    verb: "resolved a data issue on",
    tone: "positive",
    icon: "quality",
  },

  duplicate_confirmed: { label: "Duplicate confirmed", verb: "confirmed a duplicate of", tone: "neutral", icon: "duplicate" },
  duplicate_dismissed: {
    label: "Duplicate dismissed",
    verb: "dismissed a duplicate match for",
    tone: "neutral",
    icon: "duplicate",
  },

  client_criteria_rejected: {
    label: "Criteria not met",
    verb: "screened out",
    tone: "caution",
    icon: "quality",
  },
};

/** The three roles, spelled the way the rest of the app spells them. */
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  cam: "CAM",
  viewer: "Viewer",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tables `AuditResolvers` can put a name to. See `describeAuditEvent`. */
const RESOLVED_TABLES = new Set(["users", "organisations"]);

/**
 * What a `target_table` is called in front of a person.
 *
 * `missing` is not the same as `anonymous`, and the difference is the whole
 * point of having both: a row with no `target_id` was never about one record,
 * while a row whose `target_id` resolves to nothing is about a record that has
 * since been deleted. Saying "someone" in the second case hides the fact that
 * the account is gone — which, on an audit trail, is information.
 */
const TARGET_NOUNS: Record<string, { singular: string; anonymous: string; missing: string }> = {
  users: { singular: "Person", anonymous: "someone", missing: "a deleted account" },
  organisations: { singular: "Client", anonymous: "a client", missing: "a deleted client" },
  actions: { singular: "Task", anonymous: "a task", missing: "a deleted task" },
  suppressions: { singular: "Suppression", anonymous: "a suppression", missing: "a deleted suppression" },
  raw_source_records: {
    singular: "Imported record",
    anonymous: "an imported record",
    missing: "a deleted imported record",
  },
};

export type AuditDetail = {
  label: string;
  value: string;
  /** A transition renders as one chip with an arrow; a note wraps onto its own line. */
  kind: "transition" | "value" | "note";
};

export type AuditEventView = {
  id: string;
  action: string;
  label: string;
  tone: AuditTone;
  icon: AuditIconName;
  /** Full sentence, actor first. Always non-empty. */
  sentence: string;
  actorName: string;
  targetName: string | null;
  targetNoun: string | null;
  /**
   * What the sentence ends on — the record's name, what the detail preserved of
   * it, or the noun. Never an id: the expanded panel says who was affected in
   * the same words the row does.
   */
  targetDisplay: string | null;
  /**
   * Whether `targetDisplay` is a real name or the stand-in noun. A panel that
   * labels a field "Imported record" and fills it with "an imported record" has
   * said nothing twice.
   */
  targetNamed: boolean;
  details: AuditDetail[];
  /**
   * The `detail` object as raw key/value pairs, keys untouched. This is the
   * machine's version of the row and is presented as such — `formatDetails`
   * above is the readable one.
   */
  rawDetail: { key: string; value: string }[];
  /** "2 hours ago" — computed server-side against the request's clock. */
  relativeTime: string;
  /** "14 Aug 2026, 09:32" — the exact stamp, shown on hover and when expanded. */
  exactTime: string;
  /** Stable key for the day grouping, and its heading. */
  dayKey: string;
  dayLabel: string;
  /** Ids kept for the expanded panel; nobody should have to read these to skim. */
  actorId: string | null;
  targetId: string | null;
  targetTable: string | null;
};

export type AuditRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type AuditResolvers = {
  /** Person's display name, or null if the id is unknown (deleted account). */
  user: (id: string) => string | null;
  /** Client's legal name, or null. */
  organisation: (id: string) => string | null;
};

/* ─── Values ───────────────────────────────────────────────────────────── */

/**
 * A detail value rendered for a reader. Roles and pipeline statuses have their
 * own vocabulary elsewhere in the app and are spelled the same way here — a
 * status that reads "Follow up sent" on /clients must not read "follow_up_sent"
 * on this page.
 */
export function formatDetailValue(
  key: string,
  value: unknown,
  resolvers: AuditResolvers,
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") {
    // `from`/`to` booleans are the account active flag (set_user_active), where
    // "Inactive → Active" is the whole story. Any other flag is a yes/no answer
    // to whatever its key asked, and "Healthcare aligned: Inactive" is nonsense.
    const isActiveFlag = key === "from" || key === "to" || key === "active" || key === "is_active";
    return isActiveFlag ? (value ? "Active" : "Inactive") : value ? "Yes" : "No";
  }
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return JSON.stringify(value);

  if (key === "role" || key.endsWith("_role") || key === "from" || key === "to") {
    if (ROLE_LABELS[value]) return ROLE_LABELS[value];
  }
  if (UUID.test(value)) {
    const name = key.includes("organisation") ? resolvers.organisation(value) : resolvers.user(value);
    // A raw uuid is worse than useless in a sentence; the expanded panel has it.
    return name ?? `#${value.slice(0, 8)}`;
  }
  if (key === "from" || key === "to" || key === "status") return formatOutreachStatus(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatExactTime(new Date(value));
  // Any other machine token — `needs_review`, `soft_no` — gets the same
  // treatment the action itself does. A value written in snake_case is the
  // database's spelling wherever it appears, not just in the `action` column.
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(value)) return humaniseToken(value);
  // A single-word enum has no underscore to give it away, so it is capitalised
  // by the key it sits under rather than by shape — capitalising every lowercase
  // string would also capitalise an email address and a country code.
  if (ENUM_KEYS.has(key)) return humaniseToken(value);
  return value;
}

/** Detail keys that carry free text and deserve a full-width line. */
const NOTE_KEYS = new Set(["reason", "note", "reasons", "outcome"]);

/** Keys whose values are enums, so a bare lowercase word is a token to tidy. */
const ENUM_KEYS = new Set([
  "priority",
  "type",
  "organisation_type",
  "outcome",
  "status",
  "role",
  "source",
  "trigger",
]);

/** Keys that only exist so a support engineer can find the row again. */
const OPAQUE_KEYS = new Set([
  "suppression_id",
  "flag_id",
  "event_id",
  "entity_match_candidate_id",
  "organisation_id",
]);

const DETAIL_LABELS: Record<string, string> = {
  attempted_role: "Attempted",
  from_user_id: "From",
  to_user_id: "To",
  invited_at: "Invited",
  rule_name: "Rule",
  company_number: "Company number",
  organisation_type: "Type",
  self_claim: "Claimed by themselves",
  trigger: "Triggered by",
  source: "Source",
  active: "Active",
};

/**
 * The `detail` object as an ordered list of readable pairs.
 *
 * `from`/`to` collapse into a single transition chip: they are always written as
 * a pair (docs/audit-log-pattern.md §3.4) and reading them as two separate
 * fields is what made the old table unreadable. Opaque ids are dropped — they
 * survive in the expanded panel's raw JSON, which is where an engineer looks.
 */
export function formatDetails(
  detail: Record<string, unknown> | null,
  resolvers: AuditResolvers,
  omit: readonly string[] = [],
): AuditDetail[] {
  if (!detail) return [];
  const entries: AuditDetail[] = [];
  const skip = new Set(omit);

  if ("from" in detail || "to" in detail) {
    const from = formatDetailValue("from", detail.from, resolvers);
    const to = formatDetailValue("to", detail.to, resolvers);
    entries.push({ label: "Changed", value: `${from} → ${to}`, kind: "transition" });
  }

  for (const [key, value] of Object.entries(detail)) {
    if (key === "from" || key === "to") continue;
    if (OPAQUE_KEYS.has(key) || skip.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    const formatted = formatDetailValue(key, value, resolvers);
    // An id that resolved to nothing stays a uuid however it is shortened, and a
    // chip reading "#c77c901c" is noise on a row someone is skimming. The
    // expanded panel still prints the detail object untouched.
    if (formatted.startsWith("#") && typeof value === "string" && UUID.test(value)) continue;
    entries.push({
      label: DETAIL_LABELS[key] ?? humaniseToken(key),
      value: formatted,
      kind: NOTE_KEYS.has(key) ? "note" : "value",
    });
  }

  return entries;
}

/* ─── The row ──────────────────────────────────────────────────────────── */

/**
 * One row, ready to render. The sentence is built rather than templated in the
 * component so the two grammatical edge cases live next to the vocabulary they
 * belong to: an actor we can't name, and someone accepting their own invite.
 */
export function describeAuditEvent(
  row: AuditRow,
  resolvers: AuditResolvers,
  now: Date,
): AuditEventView {
  const spec = AUDIT_ACTIONS[row.action];
  const label = spec?.label ?? humaniseToken(row.action);
  const when = new Date(row.created_at);

  const actorName = row.actor_user_id ? (resolvers.user(row.actor_user_id) ?? "A removed account") : "The system";

  const targetNoun = row.target_table ? (TARGET_NOUNS[row.target_table]?.singular ?? humaniseToken(row.target_table)) : null;
  const targetName =
    row.target_id && row.target_table
      ? row.target_table === "organisations"
        ? resolvers.organisation(row.target_id)
        : row.target_table === "users"
          ? resolvers.user(row.target_id)
          : null
      : null;

  const nouns = row.target_table ? TARGET_NOUNS[row.target_table] : undefined;
  const anonymous = nouns?.anonymous ?? `a ${humaniseToken(row.target_table ?? "").toLowerCase()}`;
  // "Deleted" is only claimed for the two tables the page actually looks names
  // up in. A target in any other table has no name here because nothing tried to
  // find one — saying it was deleted would be inventing a fact.
  const looksDeleted = row.target_id && row.target_table && RESOLVED_TABLES.has(row.target_table);
  const fallbackNoun = row.target_table
    ? looksDeleted
      ? (nouns?.missing ?? anonymous)
      : anonymous
    : null;

  // What the sentence ends on, in order of how much it tells the reader: the
  // record's own name, then whatever the detail preserved of it, then the noun.
  const namedFromDetail =
    spec?.objectKey && typeof row.detail?.[spec.objectKey] === "string"
      ? (row.detail[spec.objectKey] as string)
      : null;
  const object = targetName ?? namedFromDetail ?? fallbackNoun;
  // A key spent on the sentence is not repeated as a chip underneath it.
  const spentKeys = !targetName && namedFromDetail && spec?.objectKey ? [spec.objectKey] : [];

  let sentence: string;
  if (row.action === "invite_accepted" && row.actor_user_id && row.actor_user_id === row.target_id) {
    // Self-acceptance is the normal case; "X accepted the invite for X" is not English.
    sentence = `${actorName} accepted their invite`;
  } else if (spec?.verb) {
    sentence = object ? `${actorName} ${spec.verb} ${object}` : `${actorName} ${spec.verb}`;
  } else {
    // Unmapped action: say plainly what the token was rather than guessing grammar.
    sentence = object
      ? `${actorName} — ${label.toLowerCase()} on ${object}`
      : `${actorName} — ${label.toLowerCase()}`;
  }

  return {
    id: row.id,
    action: row.action,
    label,
    tone: spec?.tone ?? "neutral",
    icon: spec?.icon ?? "generic",
    sentence,
    actorName,
    targetName,
    targetNoun,
    targetDisplay: object,
    targetNamed: Boolean(targetName ?? namedFromDetail),
    details: formatDetails(row.detail, resolvers, spentKeys),
    rawDetail: Object.entries(row.detail ?? {}).map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    })),
    relativeTime: formatRelativeTime(when, now),
    exactTime: formatExactTime(when),
    dayKey: dayKeyOf(when),
    dayLabel: formatDayLabel(when, now),
    actorId: row.actor_user_id,
    targetId: row.target_id,
    targetTable: row.target_table,
  };
}

/**
 * Free-text search over what the reader can actually see. Matching the rendered
 * strings rather than the raw row is the point: someone who searches "invite
 * cancelled" is reading the page, not the database, and would find nothing if
 * this matched `invite_cancelled` only.
 */
export function matchesAuditQuery(view: AuditEventView, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const haystack = [
    view.label,
    view.sentence,
    view.action,
    view.actorName,
    view.targetName ?? "",
    ...view.details.map((detail) => `${detail.label} ${detail.value}`),
  ]
    .join(" ")
    .toLowerCase();
  return term.split(/\s+/).every((word) => haystack.includes(word));
}
