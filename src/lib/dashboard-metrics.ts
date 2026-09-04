import { formatOutreachStatus } from "./organisation-format.ts";
import type { FollowUpUrgency } from "./outreach/follow-up-recommendations.ts";
import type { ReplyTrackingSummary } from "./reply-analytics.ts";

/**
 * F021/F022-F025/F027 — contacted and converted remain pipeline readings, while
 * F138 supplies Responses Received from linked reply_events instead of inferring it
 * from a client's current status.
 */
export type DashboardOrgRow = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string | null;
  updated_at: string;
  created_at: string;
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
  converted: number;
};

const RESPONSE_STATUSES = new Set([
  "responded",
  "converted",
  "future_potential",
  "soft_no",
  "hard_no",
  "loss_due_timing",
]);

const NEEDS_ATTENTION_STATUSES = new Set([
  "initial_outreach_sent",
  "follow_up_sent",
  "no_response",
]);

/**
 * The three pipeline readings above, as predicates over a single status. Exported
 * so the client list's funnel (src/app/clients/client-insights.ts) draws the same
 * stages this dashboard counts rather than re-deciding what "contacted" means.
 */
export const isContacted = (status: string) => status !== "not_contacted";
export const hasResponded = (status: string) => RESPONSE_STATUSES.has(status);
export const isConverted = (status: string) => status === "converted";

/** F022-F025 — platform-wide totals, shown to every role regardless of ownership. */
export function computeDashboardMetrics(
  rows: DashboardOrgRow[],
  replies?: Pick<ReplyTrackingSummary, "totalReplies" | "respondingClients">,
): DashboardMetrics {
  let contacted = 0;
  let converted = 0;

  for (const row of rows) {
    if (isContacted(row.outreach_status)) contacted += 1;
    if (isConverted(row.outreach_status)) converted += 1;
  }

  return {
    totalCharities: rows.length,
    contacted,
    responsesReceived: replies?.totalReplies ?? 0,
    respondingClients: replies?.respondingClients ?? 0,
    converted,
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

export type NeedsAttentionItem = {
  id: string;
  legalName: string;
  outreachStatusLabel: string;
  /**
   * F160 — set when the client's silence has crossed the owner's follow-up
   * thresholds. Absent for clients still inside the window; `urgent` marks the
   * second threshold, which AC2 requires to read as more pressing than `due`.
   */
  followUp?: { daysWaiting: number; urgency: FollowUpUrgency };
};

/**
 * F027 — the logged-in CAM's own clients sent an outreach that hasn't come back
 * yet. Personal, not platform-wide: unlike computeDashboardMetrics, this filters
 * to `owner_id === actorId` first. Longest-waiting first (oldest updated_at).
 */
export function needsAttention(rows: DashboardOrgRow[], actorId: string): NeedsAttentionItem[] {
  return rows
    .filter((row) => row.owner_id === actorId && NEEDS_ATTENTION_STATUSES.has(row.outreach_status))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .map((row) => ({
      id: row.id,
      legalName: row.legal_name,
      outreachStatusLabel: formatOutreachStatus(row.outreach_status),
    }));
}
