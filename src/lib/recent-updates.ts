/**
 * F028 — Recent Updates: a platform-wide feed of what changed on clients,
 * for the CAM dashboard (src/app/dashboard/page.tsx).
 *
 * Where F029's team-activity feed answers "what did my colleagues do" from
 * audit_log alone, this answers "what happened across the platform" by merging
 * the four F075 timeline sources — notes, outreach_messages, reply_events and
 * the two client-edit audit_log actions F221 exposes to non-admins
 * (`status_changed`, `ownership_reassigned`, via the
 * `audit_log_select_client_timeline` policy) — into one newest-first list.
 *
 * Kept out of the route so it can be tested without a database, and built ON
 * TOP of @/lib/timeline.ts rather than beside it: every entry is produced by
 * that module's already-tested builders, then tagged with the client it
 * happened on. The caller supplies the org-name map (the dashboard already has
 * the organisations rows in memory), and entries whose organisation is missing
 * from that map are dropped — which is also how suppressed clients fall out of
 * the feed, since the dashboard builds its map from the post-
 * filterActiveSuppressed rows.
 */

import {
  buildEmailSentEntry,
  buildNoteEntries,
  buildOwnershipReassignedEntry,
  buildReplyReceivedEntry,
  buildStatusChangedEntry,
  TIMELINE_EVENT_LABEL,
  type AuditRow,
  type NoteRow,
  type OutreachMessageRow,
  type ReplyEventRow,
  type TimelineEntry,
} from "./timeline.ts";
import { formatRelativeTime } from "./display-format.ts";

/** AC3 — the feed shows a recent window, not the platform's entire history. */
export const RECENT_UPDATES_WINDOW_DAYS = 14;

/** AC3 — and a bounded number of items, not an unbounded scroll. */
export const RECENT_UPDATES_LIMIT = 15;

/** How many rows to ask each source table for before merging and capping. */
export const RECENT_UPDATES_SOURCE_FETCH_CAP = 50;

/**
 * The cutoff the SQL queries pre-filter on AND the merged feed filters by.
 * Notes are queried with `or(created_at.gte.cutoff, updated_at.gte.cutoff)`
 * because an old note edited inside the window is still a recent event —
 * @/lib/timeline.ts emits the edit as its own entry at `updated_at`.
 */
export function recentUpdatesCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RECENT_UPDATES_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export type RecentNoteRow = NoteRow & { organisation_id: string };
export type RecentOutreachMessageRow = OutreachMessageRow & { organisation_id: string };
export type RecentReplyEventRow = ReplyEventRow & { organisation_id: string };
/** audit_log keys off target_table + target_id, not organisation_id. */
export type RecentAuditRow = AuditRow & { target_id: string };

export type RecentUpdatesSources = {
  notes: readonly RecentNoteRow[];
  outreachMessages: readonly RecentOutreachMessageRow[];
  replyEvents: readonly RecentReplyEventRow[];
  auditRows: readonly RecentAuditRow[];
};

/** One feed row: what changed, on which client, when, and by whom. */
export type FormattedRecentUpdate = {
  id: string;
  orgId: string;
  orgName: string;
  href: string;
  eventLabel: string;
  actorName: string;
  summary: string;
  relativeTime: string;
  timestamp: string;
};

type ScopedEntry = TimelineEntry & { orgId: string; orgName: string };

/**
 * Attaches the client (id + name) to entries produced by @/lib/timeline.ts's
 * builders and drops any whose organisation the caller didn't supply a name
 * for (deleted, or filtered out of the dashboard's visible set).
 */
function scopeToOrg(
  entries: readonly TimelineEntry[],
  orgId: string,
  orgNames: ReadonlyMap<string, string>,
): ScopedEntry[] {
  const orgName = orgNames.get(orgId);
  if (!orgName) return [];
  return entries.map((entry) => ({ ...entry, orgId, orgName }));
}

function withinWindow(timestamp: string, cutoff: Date): boolean {
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return false;
  return time >= cutoff.getTime();
}

/**
 * Merges every source into one newest-first feed over the last
 * RECENT_UPDATES_WINDOW_DAYS days, capped at RECENT_UPDATES_LIMIT items.
 *
 * Like @/lib/team-activity.ts, formatting happens here so the page passes
 * plain data to a dumb component; like @/lib/timeline.ts, unrecognised audit
 * actions are dropped silently rather than rendered generically.
 */
export function buildRecentUpdates(
  sources: RecentUpdatesSources,
  orgNames: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, string | null>,
  now: Date = new Date(),
): FormattedRecentUpdate[] {
  const cutoff = recentUpdatesCutoff(now);
  const scoped: ScopedEntry[] = [];

  for (const row of sources.notes) {
    scoped.push(...scopeToOrg(buildNoteEntries(row), row.organisation_id, orgNames));
  }
  for (const row of sources.outreachMessages) {
    const entry = buildEmailSentEntry(row);
    if (entry) scoped.push(...scopeToOrg([entry], row.organisation_id, orgNames));
  }
  for (const row of sources.replyEvents) {
    scoped.push(...scopeToOrg([buildReplyReceivedEntry(row)], row.organisation_id, orgNames));
  }
  for (const row of sources.auditRows) {
    if (row.action === "status_changed") {
      scoped.push(
        ...scopeToOrg([buildStatusChangedEntry(row, names)], row.target_id, orgNames),
      );
    } else if (row.action === "ownership_reassigned") {
      scoped.push(
        ...scopeToOrg([buildOwnershipReassignedEntry(row, names)], row.target_id, orgNames),
      );
    }
  }

  return scoped
    .filter((entry) => withinWindow(entry.timestamp, cutoff))
    .sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
    )
    .slice(0, RECENT_UPDATES_LIMIT)
    .map((entry) => ({
      id: entry.id,
      orgId: entry.orgId,
      orgName: entry.orgName,
      href: `/clients/${entry.orgId}`,
      eventLabel: TIMELINE_EVENT_LABEL[entry.type],
      actorName: entry.actorName,
      summary: entry.summary,
      relativeTime: formatRelativeTime(new Date(entry.timestamp), now),
      timestamp: entry.timestamp,
    }));
}
