import type { DashboardOrgRow, GrowthPoint } from "../dashboard-metrics.ts";
import { summariseTrackedReplies } from "../reply-analytics.ts";
import {
  computeCamOutreach,
  conversionVsNoResponse,
  typicalResponseTime,
  type CamOutreachTotals,
  type CamReplyRow,
  type ConversionRatio,
  type SentMessageRow,
  type TypicalResponseTime,
} from "../cam-analytics.ts";

/**
 * F210/F212 — the team-level read of the same numbers /analytics shows one CAM.
 *
 * Every per-CAM figure is produced by calling the F206-F208 functions once per
 * CAM rather than by a second implementation, so an admin and a CAM looking at
 * the same person can never see different numbers.
 */

/** F212 AC3 — how far below the team a CAM has to sit before it is worth saying. */
export const SUPPORT_CONVERSION_FACTOR = 0.5;
export const SUPPORT_RESPONSE_FACTOR = 1.5;
/** Below this many contacted clients, a CAM's rates are not yet a signal. */
export const MIN_CONTACTED_FOR_COMPARISON = 5;

export type OutcomeRow = {
  id: string;
  organisation_id: string;
  outcome_type: string;
  created_at: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (iso: string) => iso.slice(0, 10);

/**
 * F210 — conversions per day across the trailing window, team-wide.
 *
 * Sourced from `outcomes`, not from `organisations.outreach_status`: a status
 * column records that a client converted but not *when*, so a time series is
 * impossible from it. The outcome row is written in the same transaction as the
 * status flip (20260910120000_align_outcome_taxonomy.sql), so the two agree on
 * totals — this is the same event, timestamped.
 *
 * Counts new conversions per day rather than a running total. "Conversions over
 * time" is a question about pace, and a cumulative line only ever goes up, which
 * makes a slow month look identical to a fast one.
 */
export function conversionsOverTime(
  outcomes: readonly OutcomeRow[],
  days = 30,
  now = new Date(),
): GrowthPoint[] {
  if (days < 1) return [];

  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (days - 1) * DAY_MS;

  const perDay = new Map<string, number>();

  for (const outcome of outcomes) {
    if (outcome.outcome_type !== "converted") continue;
    const created = Date.parse(outcome.created_at);
    // An unparseable timestamp cannot be placed on a day, and guessing one
    // would invent a trend. Left out of the series; still counted in totals
    // computed from status elsewhere.
    if (Number.isNaN(created) || created < start || created > end + DAY_MS - 1) continue;
    const key = dayKey(new Date(created).toISOString());
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const points: GrowthPoint[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const key = dayKey(new Date(ms).toISOString());
    points.push({ value: perDay.get(key) ?? 0, date: key });
  }

  return points;
}

export type SupportFlag = {
  kind: "no_outreach" | "low_conversion" | "slow_response";
  message: string;
};

export type CamAnalyticsRow = {
  camId: string;
  camName: string;
  totals: CamOutreachTotals;
  ratio: ConversionRatio;
  typical: TypicalResponseTime;
  flags: SupportFlag[];
};

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * F212 AC1 — one row per CAM, aggregating the same F206-F208 readings the CAM
 * sees on their own page, so an admin does not have to open each one.
 *
 * `cams` drives the rows, not the organisation table: a CAM who owns nothing
 * still belongs in the list, reported as owning nothing, rather than silently
 * disappearing from a team view.
 */
export function perCamAnalytics(
  rows: readonly DashboardOrgRow[],
  sentMessages: readonly SentMessageRow[],
  replies: readonly CamReplyRow[],
  cams: readonly { id: string; name: string }[],
): CamAnalyticsRow[] {
  const byOwner = new Map<string, DashboardOrgRow[]>();
  for (const row of rows) {
    if (!row.owner_id) continue;
    const bucket = byOwner.get(row.owner_id);
    if (bucket) bucket.push(row);
    else byOwner.set(row.owner_id, [row]);
  }

  const built = cams.map((cam) => {
    const mine = byOwner.get(cam.id) ?? [];
    const mineIds = new Set(mine.map((row) => row.id));
    const myReplies = replies.filter((reply) => mineIds.has(reply.organisation_id));
    const summary = summariseTrackedReplies(myReplies, mine);

    return {
      camId: cam.id,
      camName: cam.name,
      totals: computeCamOutreach(mine, sentMessages, summary, cam.id),
      ratio: conversionVsNoResponse(mine),
      typical: typicalResponseTime(myReplies),
      flags: [] as SupportFlag[],
    };
  });

  return built.map((row) => ({ ...row, flags: supportFlagsFor(row, built) }));
}

/**
 * F212 AC2 — the view has to point at who might need help, not just print
 * numbers. Comparison is against the team median rather than the mean, because
 * one very strong or very weak CAM should not move the bar everyone is held to.
 *
 * A CAM is only compared once they have contacted enough clients to have a rate
 * worth reading; before that the only thing worth saying is that they have not
 * started.
 */
function supportFlagsFor(
  row: Omit<CamAnalyticsRow, "flags">,
  all: readonly Omit<CamAnalyticsRow, "flags">[],
): SupportFlag[] {
  const flags: SupportFlag[] = [];

  if (row.totals.clientsOwned > 0 && row.totals.contacted === 0) {
    flags.push({
      kind: "no_outreach",
      message: "Owns clients but has not contacted any yet.",
    });
    return flags;
  }

  if (row.totals.contacted < MIN_CONTACTED_FOR_COMPARISON) return flags;

  const comparable = all.filter(
    (other) => other.totals.contacted >= MIN_CONTACTED_FOR_COMPARISON,
  );

  const conversionMedian = median(
    comparable
      .map((other) => other.totals.conversionRate)
      .filter((rate): rate is number => rate !== null),
  );
  if (
    conversionMedian !== null &&
    conversionMedian > 0 &&
    row.totals.conversionRate !== null &&
    row.totals.conversionRate < conversionMedian * SUPPORT_CONVERSION_FACTOR
  ) {
    flags.push({
      kind: "low_conversion",
      message: "Converting at less than half the team's typical rate.",
    });
  }

  const responseMedian = median(
    comparable
      .map((other) => (other.typical.hasEnoughData ? other.typical.meanSeconds : null))
      .filter((seconds): seconds is number => seconds !== null),
  );
  if (
    responseMedian !== null &&
    responseMedian > 0 &&
    row.typical.hasEnoughData &&
    row.typical.meanSeconds !== null &&
    row.typical.meanSeconds > responseMedian * SUPPORT_RESPONSE_FACTOR
  ) {
    flags.push({
      kind: "slow_response",
      message: "Clients take notably longer to reply than the team's typical.",
    });
  }

  return flags;
}

export type TeamAnalyticsTotals = {
  cams: number;
  clientsOwned: number;
  contacted: number;
  emailsSent: number;
  respondingClients: number;
  conversions: number;
  camsNeedingSupport: number;
};

/** F212 AC1 — the team headline, summed from the same per-CAM rows shown below it. */
export function teamTotals(rows: readonly CamAnalyticsRow[]): TeamAnalyticsTotals {
  return rows.reduce<TeamAnalyticsTotals>(
    (totals, row) => ({
      cams: totals.cams + 1,
      clientsOwned: totals.clientsOwned + row.totals.clientsOwned,
      contacted: totals.contacted + row.totals.contacted,
      emailsSent: totals.emailsSent + row.totals.emailsSent,
      respondingClients: totals.respondingClients + row.totals.respondingClients,
      conversions: totals.conversions + row.totals.conversions,
      camsNeedingSupport: totals.camsNeedingSupport + (row.flags.length > 0 ? 1 : 0),
    }),
    {
      cams: 0,
      clientsOwned: 0,
      contacted: 0,
      emailsSent: 0,
      respondingClients: 0,
      conversions: 0,
      camsNeedingSupport: 0,
    },
  );
}

/** Worst first, so the people who need attention are at the top of the table. */
export function sortByNeed(rows: readonly CamAnalyticsRow[]): CamAnalyticsRow[] {
  return [...rows].sort((a, b) => {
    if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
    const aRate = a.totals.conversionRate ?? Number.POSITIVE_INFINITY;
    const bRate = b.totals.conversionRate ?? Number.POSITIVE_INFINITY;
    if (aRate !== bRate) return aRate - bRate;
    return a.camName.localeCompare(b.camName);
  });
}
