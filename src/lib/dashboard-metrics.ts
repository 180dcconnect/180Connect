import { formatOutreachStatus } from "./organisation-format.ts";
import type { FollowUpUrgency } from "./outreach/follow-up-recommendations.ts";

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
};

/** Minimal shape `needsAttention` needs from an overdue ACTIONS row — see @/lib/actions's isActionOverdue for how "overdue" is decided. */
export type OverdueActionCandidate = {
  organisationId: string;
  title: string;
  dueDate: string;
};

/**
 * F027 — the logged-in CAM's own clients sent an outreach that hasn't come back
 * yet, now unioned with F172's overdue-action candidates (AC3: "also surface in
 * the CAM's Needs Attention panel", not only the Actions tab). Personal, not
 * platform-wide: the outreach half still filters to `owner_id === actorId`; the
 * overdue-action half doesn't need to, since `overdueActions` is already scoped
 * to this actor's own assigned actions by the caller's query — an action stays
 * with its assignee even if the client's ownership moves on (F257), and it is
 * still this CAM's work to chase.
 *
 * Longest-waiting first for the outreach-only rows (oldest updated_at, existing
 * behaviour); a row that owes its place to an overdue action instead sorts by
 * how overdue that action is (earliest due date first) when there is no
 * outreach signal to sort by.
 */
export function needsAttention(
  rows: DashboardOrgRow[],
  actorId: string,
  overdueActions: readonly OverdueActionCandidate[] = [],
): NeedsAttentionItem[] {
  // Earliest (most overdue) action per client, when a CAM has more than one
  // overdue action on the same client — one badge per row, not a list.
  const overdueByOrg = new Map<string, OverdueActionCandidate>();
  for (const candidate of overdueActions) {
    const existing = overdueByOrg.get(candidate.organisationId);
    if (!existing || candidate.dueDate < existing.dueDate) {
      overdueByOrg.set(candidate.organisationId, candidate);
    }
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const candidateIds = new Set<string>();
  for (const row of rows) {
    if (row.owner_id === actorId && NEEDS_ATTENTION_STATUSES.has(row.outreach_status)) {
      candidateIds.add(row.id);
    }
  }
  for (const organisationId of overdueByOrg.keys()) {
    // A candidate action can reference a client this actor no longer owns, or
    // one this fetch's `rows` doesn't include (e.g. now suppressed) — skip
    // rather than render a row with no client data behind it.
    if (rowsById.has(organisationId)) candidateIds.add(organisationId);
  }

  return [...candidateIds]
    .map((id) => rowsById.get(id)!)
    .sort((a, b) => {
      const overdueA = overdueByOrg.get(a.id)?.dueDate;
      const overdueB = overdueByOrg.get(b.id)?.dueDate;
      if (overdueA && overdueB) return overdueA < overdueB ? -1 : overdueA > overdueB ? 1 : 0;
      if (overdueA) return -1;
      if (overdueB) return 1;
      return a.updated_at.localeCompare(b.updated_at);
    })
    .map((row) => {
      const overdue = overdueByOrg.get(row.id);
      return {
        id: row.id,
        legalName: row.legal_name,
        outreachStatusLabel: formatOutreachStatus(row.outreach_status),
        ...(overdue ? { overdueAction: { title: overdue.title, dueDate: overdue.dueDate } } : {}),
      };
    });
}
