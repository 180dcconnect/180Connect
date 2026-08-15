import { formatOutreachStatus } from "./organisation-format.ts";

/**
 * F021/F022-F025/F027 — the dedicated outreach-send (F123/F125/F157), response
 * (F131/F132/F138), and reminder (F133/F160/F173/F175) tracking these tickets were
 * scoped against don't exist yet ("Dashboard metric definitions" is an open question
 * on the ticket). `outreach_status` (F145) already carries enough of that signal to
 * give the CAM real numbers instead of placeholders — these definitions are the v1
 * reading of it, meant to be swapped for the dedicated tables once those land.
 */
export type DashboardOrgRow = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string | null;
  updated_at: string;
  created_at: string;
};

export type DashboardMetrics = {
  totalCharities: number;
  contacted: number;
  responsesReceived: number;
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
export function computeDashboardMetrics(rows: DashboardOrgRow[]): DashboardMetrics {
  let contacted = 0;
  let responsesReceived = 0;
  let converted = 0;

  for (const row of rows) {
    if (isContacted(row.outreach_status)) contacted += 1;
    if (hasResponded(row.outreach_status)) responsesReceived += 1;
    if (isConverted(row.outreach_status)) converted += 1;
  }

  return {
    totalCharities: rows.length,
    contacted,
    responsesReceived,
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
