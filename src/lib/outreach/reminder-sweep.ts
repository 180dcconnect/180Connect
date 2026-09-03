import { reportError } from "../error-logging.ts";
import {
  followUpRecommendations,
  DEFAULT_FOLLOW_UP_THRESHOLDS,
  type ClientActivity,
  type FollowUpCandidate,
  type FollowUpThresholds,
} from "./follow-up-recommendations.ts";
import {
  reminderNotificationBody,
  reminderNotificationTitle,
  selectNewReminders,
  type PriorReminderNotification,
  type ReminderRecommendation,
} from "./reminder-notifications.ts";

/**
 * F175 (#171) — Reminder Notifications. DB-wiring around
 * reminder-notifications.ts's pure core, same shape as stall-sweep.ts (F183):
 * fetch team-wide inputs with the service-role admin client, compute, act,
 * record what was done so the next run doesn't repeat it.
 *
 * Team-wide, not per-CAM: F160's own dashboard usage computes recommendations
 * for the signed-in viewer's own clients only, because that is what one page
 * load needs. This sweep runs once for the whole team and fans out
 * per-owner, since it is the one place responsible for notifying every CAM.
 */

const FETCH_STEP = 1000;
const RPC_CHUNK = 500;

export type ReminderSweepResult = {
  evaluatedClients: number;
  notified: number;
};

type OrgRow = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string;
};

type ActivityRow = {
  organisation_id: string;
  last_email_sent_at: string | null;
  last_reply_received_at: string | null;
  last_status_change_at: string | null;
};

type AuditRow = {
  target_id: string | null;
  detail: { last_activity_at?: string } | null;
};

export async function runReminderSweep(now: Date = new Date()): Promise<ReminderSweepResult> {
  const { createAdminClient } = await import("../supabase/admin.ts");
  const admin = createAdminClient();
  if (!admin) throw new Error("Reminder notifications are not configured.");

  // Owned organisations only — an unowned client has nobody to remind (F160's
  // own recommendation set is meaningless without an owner to act on it).
  const all: OrgRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("organisations")
      .select("id, legal_name, outreach_status, owner_id")
      .not("owner_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + FETCH_STEP - 1)
      .overrideTypes<OrgRow[], { merge: false }>();
    if (error) {
      await reportError(error, { operation: "reminder_sweep.organisations_list" });
      throw error;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < FETCH_STEP) break;
    from += FETCH_STEP;
  }

  // Owner thresholds — same shape as stall-sweep's own read of this table.
  const { data: prefRows, error: prefError } = await admin
    .from("outreach_preferences")
    .select("user_id, first_follow_up_days, second_follow_up_days")
    .overrideTypes<
      { user_id: string; first_follow_up_days: number | null; second_follow_up_days: number | null }[],
      { merge: false }
    >();
  if (prefError) {
    await reportError(prefError, { operation: "reminder_sweep.preferences_list" });
  }
  const thresholdsByOwner = new Map<string, FollowUpThresholds>();
  for (const row of prefRows ?? []) {
    thresholdsByOwner.set(row.user_id, {
      first: row.first_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.first,
      second: row.second_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.second,
    });
  }

  // Activity clocks in chunks — admin may query any client.
  const activityByOrg = new Map<string, ClientActivity>();
  if (all.length > 0) {
    for (let i = 0; i < all.length; i += RPC_CHUNK) {
      const chunkIds = all.slice(i, i + RPC_CHUNK).map((r) => r.id);
      const { data, error } = await admin.rpc("get_clients_last_activity", {
        p_organisation_ids: chunkIds,
      });
      if (error) {
        await reportError(error, { operation: "reminder_sweep.activity_chunk" });
        continue;
      }
      for (const row of (data ?? []) as ActivityRow[]) {
        activityByOrg.set(row.organisation_id, {
          lastEmailSentAt: row.last_email_sent_at,
          lastReplyReceivedAt: row.last_reply_received_at,
          lastStatusChangeAt: row.last_status_change_at,
        });
      }
    }
  }

  // F160's recommendations are computed per owner (thresholds are personal
  // settings), then fanned into one team-wide list carrying who each one is
  // for — the dashboard only ever needed the viewer's own slice of this.
  const byOwner = new Map<string, FollowUpCandidate[]>();
  for (const row of all) {
    const candidates = byOwner.get(row.owner_id) ?? [];
    candidates.push({ id: row.id, legal_name: row.legal_name, outreach_status: row.outreach_status });
    byOwner.set(row.owner_id, candidates);
  }

  const recommendations: ReminderRecommendation[] = [];
  for (const [ownerId, candidates] of byOwner) {
    const thresholds = thresholdsByOwner.get(ownerId) ?? DEFAULT_FOLLOW_UP_THRESHOLDS;
    for (const rec of followUpRecommendations(candidates, activityByOrg, thresholds, now)) {
      recommendations.push({ ...rec, ownerId });
    }
  }

  // Prior reminder notifications, most recent first — the first row seen per
  // organisation (descending order) is the one that actually governs
  // eligibility; see reminder-notifications.ts's selectNewReminders.
  const priorNotifications: PriorReminderNotification[] = [];
  const seenOrgs = new Set<string>();
  let auditFrom = 0;
  while (true) {
    const { data, error } = await admin
      .from("audit_log")
      .select("target_id, detail")
      .eq("action", "reminder_notification_sent")
      .order("created_at", { ascending: false })
      .range(auditFrom, auditFrom + FETCH_STEP - 1)
      .overrideTypes<AuditRow[], { merge: false }>();
    if (error) {
      await reportError(error, { operation: "reminder_sweep.prior_notifications" });
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.target_id || seenOrgs.has(row.target_id)) continue;
      seenOrgs.add(row.target_id);
      const lastActivityAt = row.detail?.last_activity_at;
      if (lastActivityAt) priorNotifications.push({ organisationId: row.target_id, lastActivityAt });
    }
    if (data.length < FETCH_STEP) break;
    auditFrom += FETCH_STEP;
  }

  const eligible = selectNewReminders(recommendations, priorNotifications);

  let notified = 0;
  for (const rec of eligible) {
    // F175 AC1/AC2: create_notification is the only write path onto
    // NOTIFICATIONS (matrix §3.19); service_role is an allowed producer, same
    // as scheduled-worker.ts's notifySendFailed.
    const { data: notificationId, error: notifyError } = await admin.rpc("create_notification", {
      p_recipient_user_id: rec.ownerId,
      p_notification_type: "follow_up_due",
      p_title: reminderNotificationTitle(rec.legalName),
      p_body: reminderNotificationBody(rec),
      p_link_path: `/clients/${rec.organisationId}`,
      p_target_table: "organisations",
      p_target_id: rec.organisationId,
      p_actor_user_id: null,
    });
    if (notifyError) {
      await reportError(notifyError, {
        operation: "reminder_sweep.notify",
        organisationId: rec.organisationId,
      });
      continue;
    }
    // create_notification returns null for a skipped (deactivated/unknown)
    // recipient — nothing was actually sent, so nothing to record either.
    if (!notificationId) continue;

    const { error: auditError } = await admin.from("audit_log").insert({
      actor_user_id: null,
      action: "reminder_notification_sent",
      target_table: "organisations",
      target_id: rec.organisationId,
      detail: {
        last_activity_at: rec.lastActivityAt,
        days_waiting: rec.daysWaiting,
        urgency: rec.urgency,
        notification_id: notificationId,
      },
    });
    if (auditError) {
      // The notification already went out; failing to record it here just
      // means the next sweep may re-notify for the same episode — the safe
      // direction to fail in (a rare duplicate, not a silently missed
      // reminder), matching stall-sweep's own error-reporting discipline.
      await reportError(auditError, {
        operation: "reminder_sweep.audit_insert",
        organisationId: rec.organisationId,
      });
      continue;
    }

    notified += 1;
  }

  return { evaluatedClients: all.length, notified };
}
