/**
 * F176 (#172) — Team Activity Notifications. Pure core: which of a batch of
 * team-activity audit events belong in one recipient's digest, and the
 * title/body for that one notification. No database — the sweep
 * (team-activity-sweep.ts) assembles inputs and calls create_notification,
 * same split as reminder-notifications.ts (F175) and stall-detection.ts.
 *
 * "Team activity" reuses F029's own definition rather than inventing a
 * second one: formatTeamActivity/RawTeamActivityRow (team-activity.ts)
 * already curate which AUDIT_LOG actions are CAM-safe and worth a sentence
 * (mirrored server-side by get_recent_team_activity's action allowlist,
 * 20260817120000_create_team_activity_rpc.sql) — this file only decides
 * *grouping*, not which events count.
 */
import { formatTeamActivity, type RawTeamActivityRow } from "./team-activity.ts";

/**
 * F176 AC1: a *teammate's* action, not the recipient's own — same
 * exclude-self rule formatTeamActivities already applies for the dashboard
 * feed (F029), so a CAM is never notified about something they just did
 * themselves.
 */
export function selectDigestActivities(
  rows: readonly RawTeamActivityRow[],
  recipientId: string,
): RawTeamActivityRow[] {
  return rows.filter((row) => row.actor_user_id !== recipientId);
}

/** How many individual sentences ride in the notification body before it switches to "and N more". */
const DIGEST_PREVIEW_LIMIT = 3;

/**
 * F176 AC1/AC2: one notification per digest run, not one per event — the
 * count is the whole point, distinguishing this from a single actionable
 * alert like F174's reply notification.
 */
export function digestNotificationTitle(activityCount: number): string {
  return `${activityCount} team update${activityCount === 1 ? "" : "s"}`;
}

/**
 * A handful of the actual sentences (reusing formatTeamActivity's copy, so
 * the digest reads consistently with the dashboard's own Team Activity feed)
 * plus a count of whatever didn't fit — AC1's "identifies... without
 * needing to open it" for at least the most recent few, without the
 * notification body turning into an unbounded wall of text for a busy team.
 */
export function digestNotificationBody(
  activities: readonly RawTeamActivityRow[],
  now: Date = new Date(),
): string {
  const preview = activities
    .slice(0, DIGEST_PREVIEW_LIMIT)
    .map((row) => formatTeamActivity(row, now).sentence)
    .join(" · ");
  const remaining = activities.length - Math.min(activities.length, DIGEST_PREVIEW_LIMIT);
  return remaining > 0 ? `${preview} · and ${remaining} more` : preview;
}
