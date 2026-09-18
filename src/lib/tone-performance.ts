/**
 * F209 — Tone Performance (#204).
 *
 * The CAM can choose a tone (F107) when an email is generated. Nobody can say
 * whether any of it works: F209 wants response and conversion rates broken down
 * by tone setting, sourced from the same pipeline every other analytics figure
 * here uses.
 *
 * WHERE THE DATA COMES FROM —
 *
 * Tone: `ai_generations.tone_register` / `tone_length` (this PR's migration),
 * written once at generation time like F113's `model`. Rows with a null tone
 * are excluded outright — that is F209's AC3: only emails where the tone was
 * actually recorded count, so nothing predating the tracking or generated
 * without a tone choice can contaminate a per-tone rate. The two dials are
 * reported separately: a CAM picks a register (how it reads) and a length (how
 * much of it there is), and conflating the two would attribute a reply to a
 * warmth the CAM never chose.
 *
 * Responses: `reply_events.outreach_message_id` — the exact sent email a reply
 * answers (written by capture_outreach_reply/capture_gmail_reply). Both rates
 * are the shared client-based pair (`lib/outreach-rates.ts`): reply rate is
 * replied clients over contacted clients, win rate converted clients over
 * clients who responded. A client counts as contacted by a tone when they were
 * sent an email carrying it, and a four-reply thread with one charity is one
 * responding client, not four.
 *
 * Conversions: the email's client's current `outreach_status`. F107's settings
 * ride on individual emails, so attribution is per-email-by-client: a tone
 * "converts" when any client whose tone-recorded email(s) carry that tone
 * converted. Within a CAM's own book every email to a client shares that
 * client's tone history, so this reads exactly as "clients contacted with
 * warm emails who converted" — the question AC1 asks — without pretending to
 * know which of several emails did the persuading. Same source
 * (dashboard-metrics.isConverted) as the conversion tiles above, so this
 * figure cannot disagree with them.
 *
 * Ac1's wording is "response rate broken down by tone"; conversion is stated
 * in the same breath, and both are shown per dial — reported as the shared
 * reply rate and win rate, so a tone's numbers can be added up against the
 * funnel above them. Ac2's insufficient-data
 * indicator is a per-row note, not a hidden row: a tone with too few sends
 * still appears, marked as too early to read — hiding it would look like the
 * tone vanished. Threshold matches MIN_SAMPLE_FOR_RATIO (5), the same bar the
 * conversion-ratio card on this page already defends.
 */
import { isConverted } from "./dashboard-metrics.ts";
import { outreachRates } from "./outreach-rates.ts";
import {
  EMAIL_LENGTH_LABELS,
  EMAIL_LENGTHS,
  EMAIL_REGISTER_LABELS,
  EMAIL_REGISTERS,
} from "./outreach/stage-one-prompt.ts";

/** Same bar as F207's ratio card: below this, a rate is noise, not a trend. */
export const MIN_SENDS_FOR_TONE_RATE = 5;

export type ToneRegisterRow = {
  id: string;
  organisation_id: string;
  tone_register: string | null;
};

export type ToneLengthRow = {
  id: string;
  organisation_id: string;
  tone_length: string | null;
};

/**
 * A reply linked back to the exact sent email it answers. `undefined` allowed:
 * callers pass whatever their Supabase select typed — only presence matters
 * here, and a reply with no linked email is simply not a response to anything.
 */
export type ToneReplyRow = {
  outreach_message_id?: string | null;
};

export type ToneStatusRow = {
  /** outreach_messages.id — the email whose tone is being judged. */
  message_id: string;
  organisation_id: string;
  /** The client's current pipeline status; converted is the only one counted. */
  outreach_status: string;
};

export type ToneBreakdownRow = {
  value: string;
  label: string;
  /** Sent emails carrying this tone — the sample size a rate is judged on. */
  sent: number;
  /** Distinct clients sent an email carrying this tone. */
  contactedClients: number;
  /** Distinct clients who replied to one of those emails. */
  repliedClients: number;
  /** Distinct clients in this bucket whose current status is converted. */
  convertedClients: number;
  /** replied clients ÷ contacted clients; null when nothing was sent. */
  replyRate: number | null;
  /** converted clients ÷ responded clients (replied ∪ converted). */
  winRate: number | null;
  hasEnoughData: boolean;
  threshold: number;
};

export type TonePerformanceSummary = {
  register: ToneBreakdownRow[];
  length: ToneBreakdownRow[];
  /**
   * Rows excluded because their dial was never recorded (AC3 visibility): how
   * many emails were sent with an unrecorded register, and how many with an
   * unrecorded length. Two counts because the two dials are summarised
   * independently — one row feeds both.
   */
  untrackedRegister: number;
  untrackedLength: number;
  threshold: number;
};

/**
 * What one dial value accumulated. `clients` and `replied` are keyed by client
 * id, not counted, because both rates are ratios of clients and win rate's
 * denominator is a union — counts cannot express either.
 */
type ToneBucket = {
  sent: number;
  clients: Set<string>;
  replied: Set<string>;
  converted: Set<string>;
};

function buildRow(
  value: string,
  label: string,
  bucket: ToneBucket | undefined,
  threshold: number,
): ToneBreakdownRow {
  const sent = bucket?.sent ?? 0;
  const contacted = bucket?.clients ?? new Set<string>();
  const replied = bucket?.replied ?? new Set<string>();
  const converted = bucket?.converted ?? new Set<string>();
  const rates = outreachRates({ contacted, replied, converted });
  return {
    value,
    label,
    sent,
    contactedClients: rates.contactedClients,
    repliedClients: rates.repliedClients,
    convertedClients: rates.convertedClients,
    replyRate: rates.replyRate,
    winRate: rates.winRate,
    // The sample is judged on sends, not clients: a tone is a property of an
    // email, and "warm" having gone out three times is three readings of how
    // the wording lands however many clients they reached.
    hasEnoughData: sent >= threshold,
    threshold,
  };
}

function buildRows(
  values: readonly string[],
  labels: Record<string, string>,
  sample: ReadonlyMap<string, ToneBucket>,
  threshold: number,
): ToneBreakdownRow[] {
  return values.map((value) =>
    buildRow(value, labels[value] ?? value, sample.get(value), threshold),
  );
}

/**
 * Group the raw rows once; both dials read from the same shape. `sample` keys
 * are the dial values as stored; anything not in `values` (a value written by
 * an older enum, say) is counted as sent but rendered under its raw value so
 * nothing silently vanishes.
 */
/**
 * Either dial's row shape: the row carries its own dial's value and simply
 * lacks the other. Both keys optional so one type can be indexed by either.
 */
type ToneDialRow = {
  id: string;
  organisation_id: string;
  tone_register?: string | null;
  tone_length?: string | null;
};

function summariseDial(
  rows: readonly ToneDialRow[],
  key: "tone_register" | "tone_length",
  values: readonly string[],
  labels: Record<string, string>,
  respondedMessageIds: ReadonlySet<string>,
  convertedClientsByMessage: ReadonlyMap<string, string>,
  threshold: number,
): ToneBreakdownRow[] {
  const sample = new Map<string, ToneBucket>();
  const extra = new Set<string>();

  for (const row of rows) {
    const value = row[key];
    // Null dial = never recorded (AC3): dropped here; countUntracked reports
    // the volume separately so the exclusion stays visible.
    if (!value) continue;
    const bucket =
      sample.get(value) ?? { sent: 0, clients: new Set<string>(), replied: new Set<string>(), converted: new Set<string>() };
    bucket.sent += 1;
    bucket.clients.add(row.organisation_id);
    if (respondedMessageIds.has(row.id)) bucket.replied.add(row.organisation_id);
    const converted = convertedClientsByMessage.get(row.id);
    if (converted) bucket.converted.add(converted);
    sample.set(value, bucket);
    if (!values.includes(value)) extra.add(value);
  }

  const known = buildRows(values, labels, sample, threshold);
  // A value outside the current enum accumulated a real bucket above — keep
  // its responses and conversions. Zeroing them (as this branch once did)
  // made genuine results vanish from the row the email is displayed under.
  const unknown: ToneBreakdownRow[] = Array.from(extra).map((value) =>
    buildRow(value, value, sample.get(value), threshold),
  );
  return [...known, ...unknown];
}

export function tonePerformanceSummary(
  registerRows: readonly ToneRegisterRow[],
  lengthRows: readonly ToneLengthRow[],
  replies: readonly ToneReplyRow[],
  statuses: readonly ToneStatusRow[],
  options: { threshold?: number } = {},
): TonePerformanceSummary {
  const threshold = options.threshold ?? MIN_SENDS_FOR_TONE_RATE;

  // One reply is one response per email, however many the client sent.
  const respondedMessageIds = new Set<string>();
  for (const reply of replies) {
    if (reply.outreach_message_id) respondedMessageIds.add(reply.outreach_message_id);
  }

  // Converted is a property of the client, attributed to every tone-recorded
  // email the CAM sent them. Rows with no current status carry no conversion.
  const convertedClientsByMessage = new Map<string, string>();
  for (const status of statuses) {
    if (isConverted(status.outreach_status)) {
      convertedClientsByMessage.set(status.message_id, status.organisation_id);
    }
  }

  const register = summariseDial(
    registerRows,
    "tone_register",
    EMAIL_REGISTERS,
    EMAIL_REGISTER_LABELS,
    respondedMessageIds,
    convertedClientsByMessage,
    threshold,
  );
  const length = summariseDial(
    lengthRows,
    "tone_length",
    EMAIL_LENGTHS,
    EMAIL_LENGTH_LABELS,
    respondedMessageIds,
    convertedClientsByMessage,
    threshold,
  );

  const registerUntracked = countUntracked(registerRows, "tone_register");
  const lengthUntracked = countUntracked(lengthRows, "tone_length");

  return {
    register,
    length,
    untrackedRegister: registerUntracked,
    untrackedLength: lengthUntracked,
    threshold,
  };
}

function countUntracked(rows: readonly ToneDialRow[],
  key: "tone_register" | "tone_length",
): number {
  let count = 0;
  for (const row of rows) {
    if (!row[key]) count += 1;
  }
  return count;
}

/**
 * One line of copy per row: the sample size when it is readable, the
 * insufficient-data note when it is not (AC2), and "no sends" for a tone that
 * has never been chosen rather than a misleading 0%.
 */
export function describeToneRow(row: ToneBreakdownRow): string {
  if (row.sent === 0) return "Never used yet.";
  if (!row.hasEnoughData) {
    return `Too few emails to read as a trend (${row.sent} of ${row.threshold} needed).`;
  }
  return `Based on ${row.sent} sent email${row.sent === 1 ? "" : "s"}.`;
}
