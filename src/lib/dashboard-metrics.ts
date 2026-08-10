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

/** F022-F025 — platform-wide totals, shown to every role regardless of ownership. */
export function computeDashboardMetrics(rows: DashboardOrgRow[]): DashboardMetrics {
  let contacted = 0;
  let responsesReceived = 0;
  let converted = 0;

  for (const row of rows) {
    if (row.outreach_status !== "not_contacted") contacted += 1;
    if (RESPONSE_STATUSES.has(row.outreach_status)) responsesReceived += 1;
    if (row.outreach_status === "converted") converted += 1;
  }

  return {
    totalCharities: rows.length,
    contacted,
    responsesReceived,
    converted,
  };
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
