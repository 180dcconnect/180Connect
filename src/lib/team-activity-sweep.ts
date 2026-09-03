import { reportError } from "./error-logging.ts";
import type { RawTeamActivityRow } from "./team-activity.ts";
import {
  digestNotificationBody,
  digestNotificationTitle,
  selectDigestActivities,
} from "./team-activity-digest.ts";

/**
 * F176 (#172) — Team Activity Notifications. DB-wiring around
 * team-activity-digest.ts's pure core, same shape as stall-sweep.ts (F183)
 * and reminder-sweep.ts (F175): fetch team-wide inputs with the
 * service-role admin client, compute, act, record what was done so the next
 * run doesn't repeat it.
 *
 * BATCHED, NOT ONE-PER-EVENT (AC2 — the ticket's own resolution of its
 * "Noise control rules" blocker): this runs on an interval (hourly, see the
 * cron migration) rather than firing the instant an audit row lands. Every
 * new team-activity event since the last run is collected once, then handed
 * to every active user as at most one digest notification each — never one
 * notification per event. The alternative AC2 offers (a per-type on/off
 * switch via F178) is not built here: F178 is not a dependency of this
 * ticket, and building its whole preferences system just to reach the same
 * "not noisy" outcome would be scope this ticket doesn't own.
 *
 * "Team activity" reuses F029's exact action allowlist (mirrored from
 * get_recent_team_activity, 20260817120000_create_team_activity_rpc.sql) so
 * this sweep and the dashboard's own feed never disagree about what counts.
 */

const FETCH_STEP = 1000;

const TEAM_ACTIVITY_ACTIONS = [
  "ownership_assigned",
  "ownership_reassigned",
  "status_changed",
  "suppression_requested",
  "suppression_approved",
  "organisation_status_flagged",
  "organisation_status_flag_acknowledged",
  "data_quality_event_resolved",
  "duplicate_confirmed",
  "duplicate_dismissed",
  "invite_accepted",
] as const;

/** No prior sweep yet: look back this far rather than digesting the entire audit history on first run. */
const INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

export type TeamActivitySweepResult = {
  newEvents: number;
  recipientsNotified: number;
};

type RawAuditRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export async function runTeamActivitySweep(now: Date = new Date()): Promise<TeamActivitySweepResult> {
  const { createAdminClient } = await import("./supabase/admin.ts");
  const admin = createAdminClient();
  if (!admin) throw new Error("Team activity notifications are not configured.");

  // Watermark: everything already digested up to this point. Stored the same
  // way stall-sweep tracks its own "latest recorded sweep" — one audit_log
  // marker row, no separate state table needed.
  const { data: lastSweep, error: lastSweepError } = await admin
    .from("audit_log")
    .select("detail")
    .eq("action", "team_activity_digest_swept")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ detail: { up_to?: string } }>();
  if (lastSweepError) {
    await reportError(lastSweepError, { operation: "team_activity_sweep.last_marker" });
  }
  const cutoff = lastSweep?.detail?.up_to ?? new Date(now.getTime() - INITIAL_LOOKBACK_MS).toISOString();

  const rawRows: RawAuditRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("audit_log")
      .select("id, actor_user_id, action, target_table, target_id, detail, created_at")
      .in("action", TEAM_ACTIVITY_ACTIONS)
      .not("actor_user_id", "is", null)
      .gt("created_at", cutoff)
      .lte("created_at", now.toISOString())
      .order("created_at", { ascending: true })
      .range(from, from + FETCH_STEP - 1)
      .overrideTypes<RawAuditRow[], { merge: false }>();
    if (error) {
      await reportError(error, { operation: "team_activity_sweep.new_events" });
      throw error;
    }
    if (!data || data.length === 0) break;
    rawRows.push(...data);
    if (data.length < FETCH_STEP) break;
    from += FETCH_STEP;
  }

  // Resolve actor/organisation names the same way get_recent_team_activity
  // does server-side for the authenticated-scoped read — this sweep runs as
  // service_role against audit_log directly, so the joins are done by hand.
  const actorIds = new Set<string>();
  const orgIds = new Set<string>();
  for (const row of rawRows) {
    if (row.actor_user_id) actorIds.add(row.actor_user_id);
    if (row.target_table === "organisations" && row.target_id) orgIds.add(row.target_id);
  }

  const actorNames = new Map<string, string>();
  if (actorIds.size > 0) {
    const { data, error } = await admin
      .from("users")
      .select("id, full_name, email")
      .in("id", [...actorIds]);
    if (error) {
      await reportError(error, { operation: "team_activity_sweep.actor_names" });
    }
    for (const row of (data ?? []) as { id: string; full_name: string | null; email: string }[]) {
      actorNames.set(row.id, row.full_name?.trim() || row.email);
    }
  }

  const orgNames = new Map<string, string>();
  if (orgIds.size > 0) {
    const { data, error } = await admin
      .from("organisations")
      .select("id, legal_name")
      .in("id", [...orgIds]);
    if (error) {
      await reportError(error, { operation: "team_activity_sweep.org_names" });
    }
    for (const row of (data ?? []) as { id: string; legal_name: string }[]) {
      orgNames.set(row.id, row.legal_name);
    }
  }

  const events: RawTeamActivityRow[] = rawRows.map((row) => ({
    id: row.id,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_user_id ? (actorNames.get(row.actor_user_id) ?? null) : null,
    action: row.action,
    target_table: row.target_table,
    target_id: row.target_id,
    target_name: row.target_id ? (orgNames.get(row.target_id) ?? null) : null,
    detail: row.detail,
    created_at: row.created_at,
  }));

  let recipientsNotified = 0;

  if (events.length > 0) {
    const { data: activeUsers, error: usersError } = await admin
      .from("users")
      .select("id")
      .eq("is_active", true);
    if (usersError) {
      await reportError(usersError, { operation: "team_activity_sweep.active_users" });
    }

    for (const user of activeUsers ?? []) {
      const myActivities = selectDigestActivities(events, user.id);
      if (myActivities.length === 0) continue;

      // F176 AC1/AC2: create_notification is the only write path onto
      // NOTIFICATIONS (matrix §3.19); service_role is an allowed producer,
      // same as the reminder and stall sweeps. No single actor — this
      // summarises everyone's activity, not one person's.
      const { data: notificationId, error: notifyError } = await admin.rpc("create_notification", {
        p_recipient_user_id: user.id,
        p_notification_type: "team_activity_digest",
        p_title: digestNotificationTitle(myActivities.length),
        p_body: digestNotificationBody(myActivities, now),
        p_link_path: "/dashboard",
        p_target_table: null,
        p_target_id: null,
        p_actor_user_id: null,
      });
      if (notifyError) {
        await reportError(notifyError, {
          operation: "team_activity_sweep.notify",
          recipientUserId: user.id,
        });
        continue;
      }
      if (notificationId) recipientsNotified += 1;
    }
  }

  // Advance the watermark regardless of whether anything was sent, so a
  // quiet period never gets reprocessed on the next run.
  const { error: markerError } = await admin.from("audit_log").insert({
    actor_user_id: null,
    action: "team_activity_digest_swept",
    target_table: null,
    target_id: null,
    detail: { up_to: now.toISOString(), new_events: events.length },
  });
  if (markerError) {
    await reportError(markerError, { operation: "team_activity_sweep.marker_insert" });
  }

  return { newEvents: events.length, recipientsNotified };
}
