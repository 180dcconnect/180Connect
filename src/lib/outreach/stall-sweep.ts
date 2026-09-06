import { reportError } from "../error-logging.ts";
import { chunk, fetchPaged } from "../supabase/fetch-paged.ts";
import { stalledClients, type StallCandidate } from "./stall-detection.ts";
import type { ClientActivity, FollowUpThresholds } from "./follow-up-recommendations.ts";
import { DEFAULT_FOLLOW_UP_THRESHOLDS } from "./follow-up-recommendations.ts";
import {
  buildStallNotificationPayload,
  findNewlyStalledClients,
  resolveStallNotificationRecipients,
  type StallNotificationPayload,
} from "./stall-notifications.ts";

/** The activity RPC takes its ids in the body, so no URL-length ceiling applies. */
const RPC_CHUNK = 500;

export type StallSweepResult = {
  totalClients: number;
  stalledCount: number;
  newlyStalledCount: number;
  notificationsSent: number;
  changed: boolean;
};

export type OrgRow = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string | null;
};

type ActivityRow = {
  organisation_id: string;
  last_email_sent_at: string | null;
  last_reply_received_at: string | null;
  last_status_change_at: string | null;
};

export type StallSweepDeps = {
  loadOrganisations(): Promise<OrgRow[]>;
  loadPreferences(): Promise<
    {
      user_id: string;
      first_follow_up_days: number | null;
      second_follow_up_days: number | null;
    }[]
  >;
  loadActivities(orgIds: string[]): Promise<Map<string, ClientActivity>>;
  loadOpenActionOrgIds(): Promise<Set<string>>;
  loadActiveAdminUserIds(): Promise<string[]>;
  loadLatestRecordedStallIds(): Promise<string[]>;
  recordStallSweep(
    stalledIds: string[],
    newlyStalledIds: string[],
    notificationsSent: number,
  ): Promise<void>;
  notifyStalled(params: {
    recipientUserId: string;
    organisationId: string;
    payload: StallNotificationPayload;
  }): Promise<boolean>;
};

/**
 * Pure sweep coordination logic: runs stall detection, filters newly transitioned
 * stalls (Option A), dispatches notifications to active admins + owning CAMs (F184 AC2),
 * and records an audit log entry on state change.
 */
export async function sweepStalledClients(
  deps: StallSweepDeps,
  now: Date = new Date(),
): Promise<StallSweepResult> {
  const all = await deps.loadOrganisations();
  const prefRows = await deps.loadPreferences();

  const thresholdsByOwner = new Map<string, FollowUpThresholds>();
  for (const row of prefRows) {
    thresholdsByOwner.set(row.user_id, {
      first: row.first_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.first,
      second: row.second_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.second,
    });
  }

  const allOrgIds = all.map((r) => r.id);
  const activityByOrg = await deps.loadActivities(allOrgIds);
  const openOrgIds = await deps.loadOpenActionOrgIds();

  const candidates: StallCandidate[] = all.map((r) => ({
    id: r.id,
    legal_name: r.legal_name,
    outreach_status: r.outreach_status,
    owner_id: r.owner_id,
  }));

  const flags = stalledClients(candidates, activityByOrg, thresholdsByOwner, openOrgIds, now);
  const stalledIds = flags.map((f) => f.organisationId).sort();

  const previousIds = await deps.loadLatestRecordedStallIds();
  const previousIdSet = new Set(previousIds);

  const changed =
    stalledIds.length !== previousIds.length ||
    stalledIds.some((id, index) => id !== previousIds[index]);

  // F184: Alerts fire only on new transition into stalled status (Option A).
  const newlyStalledFlags = findNewlyStalledClients(flags, previousIdSet);
  const newlyStalledIds = newlyStalledFlags.map((f) => f.organisationId).sort();

  let notificationsSent = 0;
  if (newlyStalledFlags.length > 0) {
    const adminUserIds = await deps.loadActiveAdminUserIds();
    const candidateById = new Map(candidates.map((c) => [c.id, c]));

    for (const flag of newlyStalledFlags) {
      const candidate = candidateById.get(flag.organisationId);
      if (!candidate) continue;

      const recipients = resolveStallNotificationRecipients(flag.ownerId, adminUserIds);
      const payload = buildStallNotificationPayload(candidate, flag.daysWaiting);

      for (const recipientId of recipients) {
        const sent = await deps.notifyStalled({
          recipientUserId: recipientId,
          organisationId: flag.organisationId,
          payload,
        });
        if (sent) notificationsSent++;
      }
    }
  }

  if (changed) {
    await deps.recordStallSweep(stalledIds, newlyStalledIds, notificationsSent);
  }

  return {
    totalClients: all.length,
    stalledCount: stalledIds.length,
    newlyStalledCount: newlyStalledFlags.length,
    notificationsSent,
    changed,
  };
}

export async function runStallSweep(now: Date = new Date()): Promise<StallSweepResult> {
  const { createAdminClient } = await import("../supabase/admin.ts");
  const admin = createAdminClient();
  if (!admin) throw new Error("Stall detection is not configured.");

  const deps: StallSweepDeps = {
    async loadOrganisations() {
      const { data, error } = await fetchPaged<OrgRow>((from, to) =>
        admin
          .from("organisations")
          .select("id, legal_name, outreach_status, owner_id")
          .order("id", { ascending: true })
          .range(from, to)
          .overrideTypes<OrgRow[], { merge: false }>(),
      );
      // The sweep throws rather than sweeping a partial list: it writes stall
      // flags to audit_log, and a short read would record clients as unflagged
      // that were never examined.
      if (error) {
        await reportError(error, { operation: "stall_sweep.organisations_list" });
        throw error;
      }
      return data ?? [];
    },

    async loadPreferences() {
      const { data, error } = await admin
        .from("outreach_preferences")
        .select("user_id, first_follow_up_days, second_follow_up_days")
        .overrideTypes<
          { user_id: string; first_follow_up_days: number | null; second_follow_up_days: number | null }[],
          { merge: false }
        >();
      if (error) {
        await reportError(error, { operation: "stall_sweep.preferences_list" });
      }
      return data ?? [];
    },

    async loadActivities(orgIds) {
      const activityByOrg = new Map<string, ClientActivity>();
      if (orgIds.length > 0) {
        for (const ids of chunk(orgIds, RPC_CHUNK)) {
          const { data, error } = await admin.rpc("get_clients_last_activity", {
            p_organisation_ids: ids,
          });
          if (error) {
            await reportError(error, { operation: "stall_sweep.activity_chunk" });
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
      return activityByOrg;
    },

    async loadOpenActionOrgIds() {
      const { error, partial } = await fetchPaged<{ organisation_id: string }>((from, to) =>
        admin
          .from("actions")
          .select("organisation_id")
          .eq("status", "open")
          .order("organisation_id", { ascending: true })
          .range(from, to)
          .overrideTypes<{ organisation_id: string }[], { merge: false }>(),
      );
      // Unlike the organisation read this one degrades: an open action only ever
      // suppresses a stall flag, so a short list over-flags rather than under-,
      // and the sweep is still worth running.
      if (error) {
        await reportError(error, { operation: "stall_sweep.open_actions_list" });
      }
      return new Set<string>(partial.map((row) => row.organisation_id));
    },

    async loadActiveAdminUserIds() {
      const { data, error } = await admin
        .from("users")
        .select("id")
        .eq("role", "admin")
        .eq("is_active", true)
        .overrideTypes<{ id: string }[], { merge: false }>();
      if (error) {
        await reportError(error, { operation: "stall_sweep.admin_users_list" });
        return [];
      }
      return (data ?? []).map((u) => u.id);
    },

    async loadLatestRecordedStallIds() {
      const { data, error } = await admin
        .from("audit_log")
        .select("detail")
        .eq("action", "stall_swept")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ detail: { stalled?: string[] } }>();
      if (error) {
        await reportError(error, { operation: "stall_sweep.latest_audit_read" });
      }
      return [...(data?.detail?.stalled ?? [])].sort();
    },

    async recordStallSweep(stalledIds, newlyStalledIds, notificationsSent) {
      const { error } = await admin.from("audit_log").insert({
        actor_user_id: null,
        action: "stall_swept",
        target_table: "organisations",
        target_id: null,
        detail: {
          stalled: stalledIds,
          count: stalledIds.length,
          newly_stalled: newlyStalledIds,
          notifications_sent: notificationsSent,
        },
      });
      if (error) {
        await reportError(error, { operation: "stall_sweep.audit_insert" });
        throw error;
      }
    },

    async notifyStalled({ recipientUserId, organisationId, payload }) {
      try {
        const { error } = await admin.rpc("create_notification", {
          p_recipient_user_id: recipientUserId,
          p_notification_type: payload.notificationType,
          p_title: payload.title,
          p_body: payload.body,
          p_link_path: payload.linkPath,
          p_target_table: payload.targetTable,
          p_target_id: payload.targetId,
          p_actor_user_id: null,
        });
        if (error) {
          await reportError(error, {
            operation: "stall_sweep.create_notification",
            organisationId,
            recipientUserId,
          });
          return false;
        }
        return true;
      } catch (err) {
        await reportError(err, {
          operation: "stall_sweep.create_notification_exception",
          organisationId,
          recipientUserId,
        });
        return false;
      }
    },
  };

  return sweepStalledClients(deps, now);
}
