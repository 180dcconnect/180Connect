import {
  isContacted,
  isConverted,
  type DashboardOrgRow,
} from "./dashboard-metrics.ts";
import {
  formatResponseTime,
  type ReplyTrackingSummary,
  type ResponseTimeAggregate,
} from "./reply-analytics.ts";

/**
 * F206/F207/F208 — one CAM's own outreach, as opposed to the platform-wide
 * readings in dashboard-metrics.ts. That module documents itself as "shown to
 * every role regardless of ownership" and is imported by the client list's
 * funnel, so the owner-scoped sums live here instead of blurring its contract.
 * The pipeline predicates themselves are imported, never redefined, so
 * "contacted" and "converted" cannot come to mean two different things.
 *
 * Ownership basis (F206 AC2): every figure on this page describes *clients you
 * own* — organisations.owner_id === actor.id. That is the basis F206's own
 * dependency note asks for ("owned clients"), and the one summariseTrackedReplies
 * already keys its per-CAM maps on. "Emails I personally sent"
 * (outreach_messages.sent_by_user_id) is a different population after a client
 * handover, so it is reported alongside rather than swapped in silently.
 */

/** F207 — below this many resolved outcomes, a ratio is noise, not a trend. */
export const MIN_SAMPLE_FOR_RATIO = 5;

/**
 * F208 AC2 — below this many *timed* replies there is no honest typical value.
 * Low enough that a CAM a fortnight into the job clears it, so this reads as an
 * early state rather than a permanent wall.
 */
export const MIN_REPLIES_FOR_TYPICAL = 5;

/** A reply within ±25% of the mean still reads as "about typical". */
export const TYPICAL_TOLERANCE = 0.25;

export type SentMessageRow = {
  id: string;
  organisation_id: string;
  sent_by_user_id: string | null;
  sent_at: string | null;
};

export type CamReplyRow = {
  id: string;
  organisation_id: string;
  response_time_seconds?: number | null;
};

/**
 * The ownership gate. RLS on organisations is shared-read for every active user
 * (app.is_active_user()) with no owner scoping on SELECT, so the .eq() in the
 * query is a payload optimisation and *this* filter is what actually satisfies
 * F206 AC2. Same shape as needsAttention(), deliberately.
 */
export function myClients(
  rows: readonly DashboardOrgRow[],
  actorId: string,
): DashboardOrgRow[] {
  return rows.filter((row) => row.owner_id === actorId);
}

export type CamOutreachTotals = {
  clientsOwned: number;
  contacted: number;
  /** Emails sent to clients you own, whoever pressed send. */
  emailsSent: number;
  /** The subset you sent yourself. */
  emailsSentByMe: number;
  /** Sent to your clients by someone else — i.e. before a handover. */
  emailsSentBeforeHandover: number;
  repliesReceived: number;
  respondingClients: number;
  /** Responding clients over contacted clients. Null rather than NaN when nothing was contacted. */
  replyRate: number | null;
  conversions: number;
  conversionRate: number | null;
};

/**
 * F206 AC1. Reply figures come from the caller's already-computed reply summary
 * rather than being recounted here, the same arrangement computeDashboardMetrics
 * uses — the counts must agree with the dashboard's.
 *
 * Reply rate is responding *clients* over contacted clients, not replies over
 * emails: a four-message thread with one charity is one responding client, and
 * counting messages would report 400%.
 */
export function computeCamOutreach(
  mine: readonly DashboardOrgRow[],
  sentMessages: readonly SentMessageRow[],
  replies: Pick<ReplyTrackingSummary, "totalReplies" | "respondingClients">,
  actorId: string,
): CamOutreachTotals {
  const mineIds = new Set(mine.map((row) => row.id));

  let contacted = 0;
  let conversions = 0;
  for (const row of mine) {
    if (isContacted(row.outreach_status)) contacted += 1;
    if (isConverted(row.outreach_status)) conversions += 1;
  }

  let emailsSent = 0;
  let emailsSentByMe = 0;
  for (const message of sentMessages) {
    if (!mineIds.has(message.organisation_id)) continue;
    emailsSent += 1;
    if (message.sent_by_user_id === actorId) emailsSentByMe += 1;
  }

  const rate = (value: number) => (contacted === 0 ? null : value / contacted);

  return {
    clientsOwned: mine.length,
    contacted,
    emailsSent,
    emailsSentByMe,
    emailsSentBeforeHandover: emailsSent - emailsSentByMe,
    repliesReceived: replies.totalReplies,
    respondingClients: replies.respondingClients,
    replyRate: rate(replies.respondingClients),
    conversions,
    conversionRate: rate(conversions),
  };
}

/**
 * A rate as a percentage of contacted clients. Null — nothing contacted — is a
 * real state with its own wording, not a zero: "0%" would claim the CAM tried
 * and failed, when in fact they have not started.
 */
export function formatRate(rate: number | null): string {
  if (rate === null) return "No outreach yet";
  return `${Math.round(rate * 100)}% of contacted clients`;
}

export type ConversionRatio = {
  converted: number;
  noResponse: number;
  total: number;
  /** Converted per one no-response. Null when nothing has gone unanswered — never Infinity. */
  ratio: number | null;
  /** Drives the StatCard meter. Null on an empty sample. */
  convertedShare: number | null;
  hasEnoughData: boolean;
  threshold: number;
};

/**
 * F207. Read from organisations.outreach_status rather than the outcomes table:
 * status is what /dashboard and /clients already count, so this figure cannot
 * contradict another page. The outcomes row is written in the same transaction
 * as the status flip (20260910120000_align_outcome_taxonomy.sql), so the two
 * sources agree on totals anyway — status is simply the one already in hand,
 * already suppression-filtered, and already owner-scoped.
 *
 * Deliberately counts the two named statuses only. soft_no, hard_no,
 * future_potential and loss_due_timing are resolved outcomes too, but F207 asks
 * for converted against no-response specifically.
 */
export function conversionVsNoResponse(mine: readonly DashboardOrgRow[]): ConversionRatio {
  let converted = 0;
  let noResponse = 0;

  for (const row of mine) {
    if (isConverted(row.outreach_status)) converted += 1;
    else if (row.outreach_status === "no_response") noResponse += 1;
  }

  const total = converted + noResponse;

  return {
    converted,
    noResponse,
    total,
    ratio: noResponse === 0 ? null : converted / noResponse,
    convertedShare: total === 0 ? null : converted / total,
    hasEnoughData: total >= MIN_SAMPLE_FOR_RATIO,
    threshold: MIN_SAMPLE_FOR_RATIO,
  };
}

const trimNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/** The headline figure for F207. */
export function formatConversionRatio(ratio: ConversionRatio): string {
  if (ratio.total === 0) return "No outcomes yet";
  if (ratio.ratio === null) return "All converted";
  if (ratio.converted === 0) return "None converted";
  return `${trimNumber(ratio.ratio)} : 1`;
}

/**
 * F207 AC3 — the raw counts travel with the ratio wherever it goes, and a small
 * sample says so in words rather than being presented as a trend.
 */
export function describeConversionRatio(ratio: ConversionRatio): string {
  if (ratio.total === 0) {
    return "No clients have converted or gone unanswered yet.";
  }
  const counts = `${plural(ratio.converted, "conversion", "conversions")} · ${ratio.noResponse} with no response`;
  return ratio.hasEnoughData
    ? `${counts}.`
    : `${counts} · too few outcomes to read as a trend (${ratio.threshold} needed)`;
}

export type TypicalResponseTime = {
  /** Replies carrying a usable response_time_seconds — smaller than the reply count. */
  sampleSize: number;
  meanSeconds: number | null;
  fastestSeconds: number | null;
  slowestSeconds: number | null;
  hasEnoughData: boolean;
  threshold: number;
};

/**
 * F208 AC1. The mean, not the median — a deliberate call, on the grounds that
 * reply-analytics already computes and tests it. The trade-off is that one very
 * slow reply drags it, which is why the sample size is rendered next to the
 * number rather than left implicit.
 *
 * Only the *first* reply to a sent message carries response_time_seconds (the
 * trigger in 20260912170200_track_reply_response_time.sql sets it once per
 * attempt), and replies to messages predating that migration carry none. So a
 * null here means "untracked", never "instant", and is excluded from the sample
 * rather than counted as zero.
 */
export function typicalResponseTime(replies: readonly CamReplyRow[]): TypicalResponseTime {
  const durations: number[] = [];
  for (const reply of replies) {
    const seconds = reply.response_time_seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
      durations.push(seconds);
    }
  }

  if (durations.length === 0) {
    return {
      sampleSize: 0,
      meanSeconds: null,
      fastestSeconds: null,
      slowestSeconds: null,
      hasEnoughData: false,
      threshold: MIN_REPLIES_FOR_TYPICAL,
    };
  }

  const total = durations.reduce((sum, seconds) => sum + seconds, 0);

  return {
    sampleSize: durations.length,
    meanSeconds: total / durations.length,
    fastestSeconds: Math.min(...durations),
    slowestSeconds: Math.max(...durations),
    hasEnoughData: durations.length >= MIN_REPLIES_FOR_TYPICAL,
    threshold: MIN_REPLIES_FOR_TYPICAL,
  };
}

/**
 * F208 AC2 — an explicit shortfall, not formatResponseTime's generic
 * "Not available", which would read as a bug rather than as an early state.
 */
export function describeTypicalResponseTime(typical: TypicalResponseTime): string {
  if (!typical.hasEnoughData) {
    return `Not enough data yet — ${typical.sampleSize} of ${typical.threshold} timed replies.`;
  }
  return `Based on ${plural(typical.sampleSize, "timed reply", "timed replies")}.`;
}

export type TypicalComparison = "faster" | "typical" | "slower";

/** F208 AC3 — one client's time placed against the CAM's own typical value. */
export function compareToTypical(
  seconds: number,
  meanSeconds: number,
  tolerance: number = TYPICAL_TOLERANCE,
): TypicalComparison {
  if (!Number.isFinite(meanSeconds) || meanSeconds <= 0) return "typical";
  const drift = (seconds - meanSeconds) / meanSeconds;
  if (drift > tolerance) return "slower";
  if (drift < -tolerance) return "faster";
  return "typical";
}

const COMPARISON_LABEL: Record<TypicalComparison, string> = {
  faster: "faster than typical",
  typical: "about typical",
  slower: "slower than typical",
};

export type ClientResponseTime = {
  id: string;
  legalName: string;
  averageSeconds: number;
  label: string;
  comparison: TypicalComparison;
};

/**
 * F208 AC3 — the typical value as a reference the CAM can hold individual
 * clients against. Slowest first, because those are the ones worth chasing.
 * Returns nothing when the sample is too small: there is no honest comparison
 * to draw against a number we have just told the CAM not to trust.
 */
export function slowestClients(
  mine: readonly DashboardOrgRow[],
  responseTimeByClient: ReadonlyMap<string, Pick<ResponseTimeAggregate, "averageSeconds">>,
  typical: TypicalResponseTime,
  limit = 5,
): ClientResponseTime[] {
  if (!typical.hasEnoughData || typical.meanSeconds === null) return [];

  const mean = typical.meanSeconds;

  return mine
    .flatMap((row) => {
      const aggregate = responseTimeByClient.get(row.id);
      if (!aggregate) return [];
      const comparison = compareToTypical(aggregate.averageSeconds, mean);
      return [
        {
          id: row.id,
          legalName: row.legal_name,
          averageSeconds: aggregate.averageSeconds,
          comparison,
          label: `${formatResponseTime(aggregate.averageSeconds)} · ${COMPARISON_LABEL[comparison]}`,
        },
      ];
    })
    .sort((a, b) => b.averageSeconds - a.averageSeconds)
    .slice(0, limit);
}
