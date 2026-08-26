import { reportError } from "../error-logging.ts";
import { stalledClients, type StallCandidate } from "./stall-detection.ts";
import type { ClientActivity, FollowUpThresholds } from "./follow-up-recommendations.ts";
import { DEFAULT_FOLLOW_UP_THRESHOLDS } from "./follow-up-recommendations.ts";

const FETCH_STEP = 1000;
const RPC_CHUNK = 500;

export type StallSweepResult = {
  totalClients: number;
  stalledCount: number;
  changed: boolean;
};

type OrgRow = {
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

export async function runStallSweep(now: Date = new Date()): Promise<StallSweepResult> {
  const { createAdminClient } = await import("../supabase/admin.ts");
  const admin = createAdminClient();
  if (!admin) throw new Error("Stall detection is not configured.");

  // All organisations for team-wide detection.
  const all: OrgRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("organisations")
      .select("id, legal_name, outreach_status, owner_id")
      .order("id", { ascending: true })
      .range(from, from + FETCH_STEP - 1)
      .overrideTypes<OrgRow[], { merge: false }>();
    if (error) {
      await reportError(error, { operation: "stall_sweep.organisations_list" });
      throw error;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < FETCH_STEP) break;
    from += FETCH_STEP;
  }

  // Owner thresholds — small table, one read.
  const { data: prefRows, error: prefError } = await admin
    .from("outreach_preferences")
    .select("user_id, first_follow_up_days, second_follow_up_days")
    .overrideTypes<
      { user_id: string; first_follow_up_days: number | null; second_follow_up_days: number | null }[],
      { merge: false }
    >();
  if (prefError) {
    await reportError(prefError, { operation: "stall_sweep.preferences_list" });
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

  // Open actions — only status='open' counts as "action taken".
  const openOrgIds = new Set<string>();
  let actionFrom = 0;
  while (true) {
    const { data, error } = await admin
      .from("actions")
      .select("organisation_id")
      .eq("status", "open")
      .order("organisation_id", { ascending: true })
      .range(actionFrom, actionFrom + FETCH_STEP - 1)
      .overrideTypes<{ organisation_id: string }[], { merge: false }>();
    if (error) {
      await reportError(error, { operation: "stall_sweep.open_actions_list" });
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) openOrgIds.add(row.organisation_id);
    if (data.length < FETCH_STEP) break;
    actionFrom += FETCH_STEP;
  }

  const candidates: StallCandidate[] = all.map((r) => ({
    id: r.id,
    legal_name: r.legal_name,
    outreach_status: r.outreach_status,
    owner_id: r.owner_id,
  }));

  const flags = stalledClients(candidates, activityByOrg, thresholdsByOwner, openOrgIds, now);
  const stalledIds = flags.map((f) => f.organisationId).sort();

  // Compare with latest recorded sweep — stored in audit_log so the comparison
  // itself is auditable and no separate state table is needed.
  const { data: latest, error: latestError } = await admin
    .from("audit_log")
    .select("detail")
    .eq("action", "stall_swept")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ detail: { stalled?: string[] } }>();
  if (latestError) {
    await reportError(latestError, { operation: "stall_sweep.latest_audit_read" });
  }
  const previousIds = [...(latest?.detail?.stalled ?? [])].sort();
  const changed =
    stalledIds.length !== previousIds.length ||
    stalledIds.some((id, index) => id !== previousIds[index]);

  if (changed) {
    const { error: insertError } = await admin.from("audit_log").insert({
      actor_user_id: null,
      action: "stall_swept",
      target_table: "organisations",
      target_id: null,
      detail: { stalled: stalledIds, count: stalledIds.length },
    });
    if (insertError) {
      await reportError(insertError, { operation: "stall_sweep.audit_insert" });
      throw insertError;
    }
  }

  return { totalClients: all.length, stalledCount: stalledIds.length, changed };
}
