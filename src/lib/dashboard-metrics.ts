import { formatOutreachStatus } from "./organisation-format.ts";
import type { FollowUpRecommendation, FollowUpUrgency } from "./outreach/follow-up-recommendations.ts";
import type { ReplyTrackingSummary } from "./reply-analytics.ts";
import { outreachRates } from "./outreach-rates.ts";

/**
 * F021/F022-F025/F027 — contacted and converted remain pipeline readings, while
 * F138 supplies Responses Received from linked reply_events instead of inferring it
 * from a client's current status.
 *
 * The reply and win rates here are the shared client-based pair
 * (`lib/outreach-rates.ts`), so the tile captions and the Performance section
 * cannot disagree: this used to divide *replies* by contacted clients, which
 * counted a four-message thread as four responses.
 */
export type DashboardOrgRow = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string | null;
  updated_at: string;
  created_at: string;
  /** Read only by the dashboard's Performance section (SECTOR_PERFORMANCE rollup). */
  sector?: string | null;
  /**
   * Read only by the organisation hover card, for the same reason the extra
   * `users` columns exist on TeamUserRow: the dashboard already paginates every
   * organisation row, so the preview can come off that read instead of being
   * filled with nulls. Nothing in this module's metrics touches them.
   */
  organisation_type?: string | null;
  city?: string | null;
  country_code?: string | null;
  website?: string | null;
  /**
   * Register-filed purpose texts, read only by the dashboard's Priority
   * Opportunities card (mission line). Same reason as the preview columns
   * above: the dashboard already pages every organisation row.
   */
  charity_activities?: string | null;
  cic_community_statement?: string | null;
};

export type OpenSuppression = { organisation_id: string; status: "pending" | "active" };

/**
 * F022 AC3 — actively suppressed charities (F251) are excluded so they don't inflate
 * the reported outreach pool or appear in the dashboard metrics. Charities with a
 * pending suppression request remain included until an admin approves the suppression.
 */
export function filterActiveSuppressed(
  rows: DashboardOrgRow[],
  suppressions: OpenSuppression[],
): DashboardOrgRow[] {
  const statusByOrg = new Map(suppressions.map((row) => [row.organisation_id, row.status]));
  return rows.filter((row) => statusByOrg.get(row.id) !== "active");
}

export type DashboardMetrics = {
  totalCharities: number;
  contacted: number;
  responsesReceived: number;
  respondingClients: number;
  /** Replied ∪ converted — win rate's denominator, as a count. */
  respondedClients: number;
  converted: number;
  contactRate: number;
  /** replied clients ÷ contacted clients; null when nobody was contacted. */
  replyRate: number | null;
  /** converted ÷ responded clients; null when nobody responded. */
  winRate: number | null;
};

const RESPONSE_STATUSES = new Set([
  "responded",
  "converted",
  "future_potential",
  "soft_no",
  "hard_no",
  "loss_due_timing",
]);


/**
 * The three pipeline readings above, as predicates over a single status. Exported
 * so the client list's funnel (src/app/(app)/clients/client-insights.ts) draws the same
 * stages this dashboard counts rather than re-deciding what "contacted" means.
 */
export const isContacted = (status: string) => status !== "not_contacted";
export const hasResponded = (status: string) => RESPONSE_STATUSES.has(status);
export const isConverted = (status: string) => status === "converted";

/** F022-F025 — platform-wide totals, shown to every role regardless of ownership. */
export function computeDashboardMetrics(
  rows: DashboardOrgRow[],
  replies?: Pick<ReplyTrackingSummary, "totalReplies" | "respondingClients" | "byClient">,
): DashboardMetrics {
  // Client ids, not counts: the two rates are ratios of clients and win rate's
  // denominator is a union (see lib/outreach-rates.ts). `contacted` and
  // `converted` are read off the pipeline status the rest of the dashboard
  // counts, and replies come from reply_events — the same two sources as before.
  const contactedClients = new Set<string>();
  const convertedClients = new Set<string>();

  for (const row of rows) {
    if (isContacted(row.outreach_status)) contactedClients.add(row.id);
    if (isConverted(row.outreach_status)) convertedClients.add(row.id);
  }

  const totalCharities = rows.length;
  // Replies are counted from reply_events, not inferred from the pipeline
  // status: a client can be moved to "responded" by hand, and two replies from
  // one client are two replies. Folded back to the rows in hand, so a reply for
  // a record this caller did not load cannot enter a rate built from them.
  const repliedClients = new Set(
    Array.from(replies?.byClient.keys() ?? []).filter((id) => contactedClients.has(id)),
  );
  const rates = outreachRates({
    contacted: contactedClients,
    replied: repliedClients,
    converted: convertedClients,
  });

  return {
    totalCharities,
    contacted: rates.contactedClients,
    responsesReceived: replies?.totalReplies ?? 0,
    respondingClients: rates.repliedClients,
    respondedClients: rates.respondedClients,
    converted: rates.convertedClients,
    contactRate: totalCharities > 0 ? rates.contactedClients / totalCharities : 0,
    replyRate: rates.replyRate,
    winRate: rates.winRate,
  };
}

export type GrowthPoint = { value: number; date: string };

const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (iso: string) => iso.slice(0, 10);

/**
 * F022 — how the total organisation count got to where it is. One point per UTC
 * day over the trailing window, each the *cumulative* count at end of that day,
 * so the last point equals computeDashboardMetrics().totalCharities.
 *
 * Records created before the window are folded into the first point rather than
 * dropped: the line has to start at the real total, not at zero.
 */
export function organisationGrowthSeries(
  rows: DashboardOrgRow[],
  days = 30,
  now = new Date(),
): GrowthPoint[] {
  if (days < 1) return [];

  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (days - 1) * DAY_MS;

  const perDay = new Map<string, number>();
  let carried = 0;

  for (const row of rows) {
    const created = Date.parse(row.created_at);
    // A row with an unparseable created_at still exists, so it counts as
    // pre-window rather than vanishing from the total.
    if (Number.isNaN(created) || created < start) {
      carried += 1;
      continue;
    }
    const key = dayKey(new Date(Math.min(created, end)).toISOString());
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const points: GrowthPoint[] = [];
  let running = carried;

  for (let ms = start; ms <= end; ms += DAY_MS) {
    const key = dayKey(new Date(ms).toISOString());
    running += perDay.get(key) ?? 0;
    points.push({ value: running, date: key });
  }

  return points;
}

export type NeedsAttentionTrigger =
  | "overdue_action"
  | "inbound_reply"
  | "follow_up_due"
  | "stalled";

export type NeedsAttentionItem = {
  id: string;
  legalName: string;
  outreachStatus?: string;
  outreachStatusLabel: string;
  trigger?: NeedsAttentionTrigger;
  /**
   * F160 — set when the client's silence has crossed the owner's follow-up
   * thresholds. Absent for clients still inside the window; `urgent` marks the
   * second threshold, which AC2 requires to read as more pressing than `due`.
   */
  followUp?: { daysWaiting: number; urgency: FollowUpUrgency };
  /**
   * F172 — set when the actor has at least one open, overdue ACTION on this
   * client. Independent of outreach_status: a client can carry an overdue
   * action while sitting in a status this panel would otherwise never
   * surface (e.g. already `converted`), so this is what actually widens the
   * candidate set below, not just a label on rows already there.
   */
  overdueAction?: { title: string; dueDate: string };
  isInboundReply?: boolean;
  isUnreadReply?: boolean;
  isStalled?: boolean;
};

/** Minimal shape `needsAttention` needs from an overdue ACTIONS row — see @/lib/actions's isActionOverdue for how "overdue" is decided. */
export type OverdueActionCandidate = {
  organisationId: string;
  title: string;
  dueDate: string;
};

export type NeedsAttentionOptions = {
  overdueActions?: readonly OverdueActionCandidate[];
  followUps?: readonly FollowUpRecommendation[];
  unreadOrgIds?: ReadonlySet<string>;
};

/**
 * Action Center filter: surfaces clients that genuinely need the CAM's attention:
 * - Overdue actions (open tasks past their due date)
 * - Inbound replies awaiting response (responded)
 * - Due / urgent follow-ups (silence exceeded thresholds)
 * - Stalled clients (no response after full outreach cycle)
 *
 * In-flight outreach within the normal silence window is intentionally excluded.
 */
export function needsAttention(
  rows: readonly DashboardOrgRow[],
  actorId: string,
  overdueActionsOrOptions: readonly OverdueActionCandidate[] | NeedsAttentionOptions = [],
  legacyFollowUps: readonly FollowUpRecommendation[] = [],
): NeedsAttentionItem[] {
  let overdueActions: readonly OverdueActionCandidate[] = [];
  let followUps: readonly FollowUpRecommendation[] = [];
  let unreadOrgIds: ReadonlySet<string> | undefined;

  if (!Array.isArray(overdueActionsOrOptions) && typeof overdueActionsOrOptions === "object" && overdueActionsOrOptions !== null && ("overdueActions" in overdueActionsOrOptions || "followUps" in overdueActionsOrOptions || "unreadOrgIds" in overdueActionsOrOptions)) {
    const opts = overdueActionsOrOptions as NeedsAttentionOptions;
    overdueActions = opts.overdueActions ?? [];
    followUps = opts.followUps ?? [];
    unreadOrgIds = opts.unreadOrgIds;
  } else {
    overdueActions = (overdueActionsOrOptions as readonly OverdueActionCandidate[]) ?? [];
    followUps = legacyFollowUps;
  }

  // Earliest (most overdue) action per client
  const overdueByOrg = new Map<string, OverdueActionCandidate>();
  for (const candidate of overdueActions) {
    const existing = overdueByOrg.get(candidate.organisationId);
    if (!existing || candidate.dueDate < existing.dueDate) {
      overdueByOrg.set(candidate.organisationId, candidate);
    }
  }

  const followUpByOrg = new Map<string, FollowUpRecommendation>();
  for (const rec of followUps) {
    followUpByOrg.set(rec.organisationId, rec);
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const candidateIds = new Set<string>();

  for (const row of rows) {
    if (row.owner_id !== actorId) continue;

    // Trigger 1: Inbound reply awaiting response (highest outreach priority)
    if (row.outreach_status === "responded") {
      candidateIds.add(row.id);
      continue;
    }

    // Trigger 2: Follow-up is due or urgent (passed silence threshold)
    if (followUpByOrg.has(row.id)) {
      candidateIds.add(row.id);
      continue;
    }

    // Trigger 3: Truly stalled clients (no response after outreach cycle)
    if (row.outreach_status === "no_response") {
      candidateIds.add(row.id);
      continue;
    }

    // Trigger 4: Overdue action on this client
    if (overdueByOrg.has(row.id)) {
      candidateIds.add(row.id);
      continue;
    }

    // In-flight outreach within normal silence window is intentionally excluded.
  }

  // Also include any organisation with an overdue action assigned to this actor,
  // even if ownership of the client has moved (F172 AC3 / F257).
  for (const orgId of overdueByOrg.keys()) {
    if (rowsById.has(orgId)) candidateIds.add(orgId);
  }

  return [...candidateIds]
    .map((id) => rowsById.get(id)!)
    .map((row) => {
      const overdue = overdueByOrg.get(row.id);
      const followUp = followUpByOrg.get(row.id);
      const isInboundReply = row.owner_id === actorId && row.outreach_status === "responded";
      const isStalled = row.owner_id === actorId && row.outreach_status === "no_response";

      let trigger: NeedsAttentionTrigger = "follow_up_due";
      if (overdue) {
        trigger = "overdue_action";
      } else if (isInboundReply) {
        trigger = "inbound_reply";
      } else if (followUp) {
        trigger = "follow_up_due";
      } else if (isStalled) {
        trigger = "stalled";
      }

      return {
        id: row.id,
        legalName: row.legal_name,
        outreachStatus: row.outreach_status,
        outreachStatusLabel: formatOutreachStatus(row.outreach_status),
        trigger,
        ...(overdue ? { overdueAction: { title: overdue.title, dueDate: overdue.dueDate } } : {}),
        ...(followUp
          ? { followUp: { daysWaiting: followUp.daysWaiting, urgency: followUp.urgency } }
          : {}),
        ...(isInboundReply
          ? { isInboundReply: true, isUnreadReply: unreadOrgIds?.has(row.id) ?? false }
          : {}),
        ...(isStalled ? { isStalled: true } : {}),
      };
    })
    .sort((a, b) => {
      const getTier = (item: NeedsAttentionItem) => {
        if (item.overdueAction) return 1;
        if (item.followUp?.urgency === "urgent") return 1;
        if (item.isInboundReply && item.isUnreadReply) return 1;
        if (item.isInboundReply) return 2;
        if (item.followUp?.urgency === "due") return 2;
        return 3;
      };

      const tierA = getTier(a);
      const tierB = getTier(b);
      if (tierA !== tierB) return tierA - tierB;

      if (a.overdueAction && b.overdueAction) {
        return a.overdueAction.dueDate.localeCompare(b.overdueAction.dueDate);
      }
      if (a.overdueAction) return -1;
      if (b.overdueAction) return 1;

      if (a.followUp && b.followUp) {
        return b.followUp.daysWaiting - a.followUp.daysWaiting;
      }

      const rowA = rowsById.get(a.id);
      const rowB = rowsById.get(b.id);
      return (rowA?.updated_at ?? "").localeCompare(rowB?.updated_at ?? "");
    });
}
