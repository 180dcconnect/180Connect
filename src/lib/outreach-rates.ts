/**
 * The two rates this platform reports, defined once, in clients.
 *
 * "Conversion rate" used to mean six different things — converted ÷ contacted
 * in team analytics, conversions ÷ emails sent on the CAM leaderboard,
 * converted ÷ replied on the dashboard summary — so two screens could disagree
 * about the same week and both be right by their own definition. There are now
 * two names, used everywhere:
 *
 *   **Reply rate** — of the clients we contacted, how many replied.
 *   **Win rate**   — of the clients who replied, how many converted.
 *
 * Both are ratios of **clients**, never of messages. A four-message thread with
 * one charity is one responding client; divided by emails it reports 400%, and
 * a CAM who sends three follow-ups to a silent client looks more responsive
 * than one who sends a single email and gets an answer.
 *
 * ── Why the win-rate denominator is a union, not "replied" ──
 *
 * A client can be marked converted with no reply anywhere in the inbox: an
 * answered phone call, a referral, a status set by hand at a meeting. Those are
 * real wins. Counting them only in the numerator lets a win rate pass 100%;
 * leaving them out of both flatters the number, because the wins that skipped
 * the inbox quietly vanish and a CAM reads 60% when the record holds four more.
 * So a recorded conversion counts as proof of a response: the denominator is
 * replied ∪ converted, the numerator is converted, and 100% is the ceiling.
 * No win is lost and none is invented.
 *
 * ── What the pair is for ──
 *
 * replyRate × winRate = the share of contacted clients who converted, which is
 * the number the funnel chart draws. That is the point of having exactly two:
 * the leaderboard, the sector table, the tone breakdown and the funnel finally
 * multiply out to the same story instead of telling three.
 *
 * A rate is `null`, never 0, when its denominator is empty. "Nothing contacted
 * yet" and "contacted 40 clients and won none" are different states, and 0%
 * claims the second when it means the first.
 */

export type OutreachRateSets = {
  /** Distinct clients we emailed at least once. */
  contacted: ReadonlySet<string>;
  /** Distinct clients that replied at least once. */
  replied: ReadonlySet<string>;
  /** Distinct clients that converted. */
  converted: ReadonlySet<string>;
};

export type OutreachRates = {
  contactedClients: number;
  repliedClients: number;
  /** Replied ∪ converted — win rate's denominator. */
  respondedClients: number;
  convertedClients: number;
  /** Replied clients ÷ contacted clients. Null when nobody was contacted. */
  replyRate: number | null;
  /** Converted clients ÷ responded clients. Null when nobody responded. */
  winRate: number | null;
};

export function outreachRates({
  contacted,
  replied,
  converted,
}: OutreachRateSets): OutreachRates {
  const responded = new Set(replied);
  for (const organisationId of converted) responded.add(organisationId);

  return {
    contactedClients: contacted.size,
    repliedClients: replied.size,
    respondedClients: responded.size,
    convertedClients: converted.size,
    replyRate: contacted.size > 0 ? replied.size / contacted.size : null,
    winRate: responded.size > 0 ? converted.size / responded.size : null,
  };
}

/**
 * A win rate as copy for a tile caption. Null gets words rather than `0%`: a
 * CAM with no replies yet is not a CAM who lost everything. (`cam-analytics`
 * has the matching `formatRate` for the reply rate.)
 */
export function formatWinRate(rate: number | null): string {
  if (rate === null) return "No replies yet";
  return `${Math.round(rate * 100)}% of clients who replied`;
}
