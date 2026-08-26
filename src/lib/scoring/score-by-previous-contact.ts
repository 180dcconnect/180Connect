// F093: Score by Previous Contact — pure calculation logic.
//
// Decides how an organisation's own outreach history (never external data)
// should raise or lower its priority-score factor, replacing the placeholder
// mapping that used to live in score-client.ts.
//
// RANKING IDEOLOGY (confirmed with the ticket owner):
//
//   converted        1.00  Gold. A client who agreed to work with us before is
//                          the most likely to work with us again via 180 QinX,
//                          so past conversion is the strongest positive signal
//                          this factor can express (AC3: never penalised like a
//                          rejection).
//   future_potential 0.90  A human deliberately shortlisted them ("we want to
//                          work with these guys"), which beats never having
//                          looked at them at all.
//   responded         0.80  Showed live engagement.
//   not_contacted     0.70  Untapped but unqualified — could be anyone. Still
//                          outranks every negative/pending outreach state, so
//                          AC1 holds: a hard-no or recently-chased client never
//                          scores above someone we have never contacted.
//   loss_due_timing   0.50  Not a rejection of us, just bad timing — neutral.
//   initial_outreach_sent / follow_up_sent
//                     0.50  Contact in flight, outcome unknown. Subject to the
//                          recency decay below.
//   no_response       0.35  Chased and ignored. Subject to the recency decay.
//   soft_no           0.25  Closed door, politely. Stays low regardless of age.
//   hard_no           0.05  Do not re-approach. The floor of this factor.
//
// RECENCY DECAY (AC1's "contacted very recently" clause): a status alone cannot
// distinguish a follow-up sent yesterday from one sent six months ago, so for
// the unresolved statuses only (initial_outreach_sent, follow_up_sent,
// no_response) the score ramps from a floor at day zero back up to the status
// base over RECENCY_WINDOW_DAYS, using the timestamp of the organisation's most
// recent sent OUTREACH_MESSAGES row. Resolved outcomes (converted, soft_no,
// hard_no, ...) are immune — their verdict does not get staler.
//
// MISSING DATA: an unknown status degrades to neutral rather than throwing;
// a missing/unparseable last-contacted timestamp simply means the decay does
// not apply and the status base stands alone.

export type PreviousContactScoreResult = {
  score: number;
  /** True when the status says we have actually engaged this client before. */
  hasPriorContact: boolean;
  /** True when the recency decay moved the score below its status base. */
  recencyApplied: boolean;
};

/** Same neutral an unknown sector/geography gets elsewhere in this folder. */
const UNKNOWN_STATUS_SCORE = 0.5;

/**
 * The F093 decision table above. Values are a documented starting point, not
 * physics — tune here and the tests' ordering assertions will police the
 * ideology (converted on top, not_contacted under future_potential, hard_no
 * at the bottom).
 */
const BASE_BY_STATUS: Record<string, number> = {
  converted: 1.0,
  future_potential: 0.9,
  responded: 0.8,
  not_contacted: 0.7,
  loss_due_timing: 0.5,
  initial_outreach_sent: 0.5,
  follow_up_sent: 0.5,
  no_response: 0.35,
  soft_no: 0.25,
  hard_no: 0.05,
};

/** Statuses whose contact is still unresolved, so freshness matters. */
const DECAYED_STATUSES = new Set([
  "initial_outreach_sent",
  "follow_up_sent",
  "no_response",
]);

/** Score an unresolved-but-just-contacted client sinks to at day zero. */
const RECENT_CONTACT_FLOOR = 0.25;

/** Days until an unresolved contact stops counting as "very recent". */
const RECENCY_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTimestamp(
  value: string | Date | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function scoreByPreviousContact(
  outreachStatus: string,
  lastContactedAt?: string | Date | null,
  now: Date = new Date(),
): PreviousContactScoreResult {
  const base = BASE_BY_STATUS[outreachStatus];
  if (base === undefined) {
    return {
      score: UNKNOWN_STATUS_SCORE,
      hasPriorContact: false,
      recencyApplied: false,
    };
  }

  const hasPriorContact = outreachStatus !== "not_contacted";
  const lastSent = parseTimestamp(lastContactedAt);

  if (
    !DECAYED_STATUSES.has(outreachStatus) ||
    !hasPriorContact ||
    !lastSent
  ) {
    return { score: base, hasPriorContact, recencyApplied: false };
  }

  // Clamp at zero so a future-dated timestamp (clock skew, seeded data) counts
  // as "today" rather than pushing the score above the floor.
  const ageDays = Math.max(0, (now.getTime() - lastSent.getTime()) / DAY_MS);
  const recoveryRatio = Math.min(ageDays / RECENCY_WINDOW_DAYS, 1);
  const score = RECENT_CONTACT_FLOOR +
    (base - RECENT_CONTACT_FLOOR) * recoveryRatio;

  return {
    score,
    hasPriorContact,
    recencyApplied: recoveryRatio < 1,
  };
}
