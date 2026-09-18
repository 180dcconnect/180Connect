/**
 * "Your Priority Opportunities" — the ranked shortlist behind the dashboard
 * card on /dashboard.
 *
 * The dashboards used to show only aggregate readings (band counts, mean
 * scores) — right for a standup, wrong for the person who just logged in.
 * This module answers the question those aggregates never did: who should I
 * actually talk to next. It reuses rows the pages already fetched, so the
 * card costs no extra query.
 *
 * Pure and dependency-free (no Supabase, no Date.now) so `node --test` can
 * exercise it like the other dashboard helpers.
 *
 * Language note: everything this module emits is shown to non-technical
 * admins and CAMs, so highlights use the record page's own check names
 * (`src/lib/scoring/scout-checks.ts`) — never factor keys (`size`),
 * table names, or score internals. One vocabulary on every surface.
 */

import {
  SCOUT_CHECKS,
  scoutLiftShares,
  SCOUT_HELPING_CUT,
  SCOUT_NO_READING,
  type ScoutCheck,
  type ScoutCheckKey,
} from "./scoring/scout-checks.ts";
import { formatIncome } from "./income-range.ts";
import { resolveMissionText } from "./mission.ts";

export type OpportunityFactors = {
  sector: number;
  geography: number;
  size: number;
  partnershipHistory: number;
  previousContact: number;
};

/**
 * The record's own figures behind three of the five checks, so a card can say
 * "£1.4m income" instead of "Size: strong".
 *
 * Optional throughout, and fetched for the ranked few only — the dashboard
 * ranks first and reads these for the six cards it is about to draw, the same
 * way it already fetches their missions. A card without them still renders;
 * it falls back to the check's name and how strong the reading was.
 */
export type OpportunityFacts = {
  /** Income on the newest filed period that carries one, in pounds. */
  incomeGBP?: number | null;
  /** That filing's period end, for the year in brackets. */
  incomePeriodEnd?: string | null;
  /** Grants matched to this organisation in the public 360Giving data. */
  matchedGrantCount?: number | null;
};

export type OpportunityRow = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string | null;
  owner_name?: string | null;
  sector?: string | null;
  city?: string | null;
  /** Persisted SCOUT score, 0–1. Null when the organisation has no score row. */
  priority_score: number | null;
  priority_band?: string | null;
  /**
   * The persisted breakdown, when the caller selected it: the five readings
   * and the weights they were scored under. Stored jsonb, so both halves are
   * typed loosely and validated before use rather than trusted.
   */
  score_factors?: {
    factors: OpportunityFactors;
    weights?: Partial<Record<ScoutCheckKey, number>>;
    /** Which factors are a real reading rather than a stand-in for "no data". */
    readings?: Partial<Record<ScoutCheckKey, boolean>>;
  } | null;
  /** The figures behind the checks, when the caller fetched them. */
  facts?: OpportunityFacts | null;
  /** Register-filed purpose texts, for resolving the card's mission line. */
  charity_activities?: string | null;
  cic_community_statement?: string | null;
};

export type PriorityOpportunity = OpportunityRow & {
  /**
   * The 0–1 reading the card prints, to one decimal: `0.9`. A string, not a
   * number, because `1` has to print as `1.0` and `0` as `0.0` — as numbers
   * they would drop the decimal and take the column's alignment with them.
   */
  displayScore: string;
  /** What pushes this score up, largest share of the lift first. */
  highlights: OpportunityHighlight[];
  /** What the score could not read at all — "No accounts filed". */
  gaps: string[];
  /** Resolved mission text for the card; absent when the record holds none. */
  mission?: string | null;
};

/**
 * One line under "why it scores highly".
 *
 * The line leads with the *fact* wherever the record holds it — "Works in
 * Education", "£1.4m income (2024 accounts)", "6 matched grants" — rather than
 * the name of the check that read it. "Sector: strong" told a CAM only that
 * the engine liked something they could already see two lines above; the fact
 * is the thing they can act on, and it is the same fact the record page shows.
 * Where the figure was not fetched, the check's own name and the strength of
 * its reading stand in, so a line is never empty.
 */
export type OpportunityHighlight = {
  /** The fact, e.g. "6 matched grants" — or the check's name as a stand-in. */
  label: string;
  /** Reading strength, e.g. "strong" — null whenever the label is the fact itself. */
  strength: string | null;
  /** Share of the *lift*, 0–100 — null when there is no usable breakdown. */
  sharePct: number | null;
};

/**
 * Terminal or rejected outcomes — a client here is not someone to talk to
 * next, however high they once scored. Everything else (never contacted,
 * in flight, replied, gone quiet, open to future work) stays eligible.
 */
export const EXCLUDED_OPPORTUNITY_STATUSES: readonly string[] = [
  "converted",
  "hard_no",
  "soft_no",
];

/** How many opportunities the card shows. Six cards fill the 3-across grid exactly. */
export const PRIORITY_OPPORTUNITIES_LIMIT = 6;

/** 0–1 persisted score → whole number out of 100. */
export function priorityScoreOutOf100(score: number): number {
  return Math.round(score * 100);
}

/**
 * The score as the priority card prints it: the 0–1 reading itself, to one
 * decimal — `0.9`, not `90`.
 *
 * `80/100` and `0.8/1` are the same number, but only one of them is the number
 * the engine stores and the figure the record header's readout prints (`0.80`
 * there, at one more decimal than a card has room for). Printing the score as
 * its own reading means a CAM moving between the card and the record is looking
 * at the same figure rather than converting it, and "how close to 1 is this"
 * is the question the gauge beside it is already asking.
 *
 * `priorityScoreOutOf100` is kept for the analytics table, which averages
 * scores across many clients — a percentage of a whole pipeline is the honest
 * unit there, and it has the room for it.
 */
export function formatPriorityScore(score: number): string {
  return score.toFixed(1);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * What pushed one opportunity's score up, largest share of the lift first, at
 * most three lines.
 *
 * Two decisions live here.
 *
 * **Lift, not composition.** Shares come from `scoutLiftShares`, which measures
 * each check against the neutral 0.5 rather than against zero. The breakdown
 * card's `scoutContributions` answers "what is this number made of", and under
 * that arithmetic a check with nothing on record still holds a fifth of the
 * score — true as composition, false as a reason. A card headed "why it scores
 * highly" must not print a share beside an empty check, so an unread or
 * below-neutral check lifts nothing, scores 0, and drops out on its own.
 *
 * **The fact, not the lever.** Each line names what the check actually found —
 * "Works in Education", "£1.4m income (2024 accounts)", "6 matched grants" —
 * falling back to the check's name and reading strength only where the figure
 * was not fetched. See `factLine`.
 *
 * A score with nothing above neutral is still ranked and still shown: its
 * lines carry honest strength words and no share, because there is no lift to
 * apportion. Without a usable breakdown at all, falls back to what the record
 * itself says (sector, city) so the card never renders a bare score.
 */
export function scoreHighlights(row: OpportunityRow): OpportunityHighlight[] {
  // Stored JSON — guarded, never trusted blindly.
  const raw = row.score_factors;
  const factors =
    raw && typeof raw === "object" && raw.factors && typeof raw.factors === "object"
      ? (raw.factors as Partial<Record<ScoutCheckKey, unknown>>)
      : undefined;
  const rawWeights = raw && typeof raw === "object" ? raw.weights : undefined;
  const weights =
    rawWeights && typeof rawWeights === "object"
      ? (rawWeights as Partial<Record<ScoutCheckKey, unknown>>)
      : undefined;

  if (factors && weights) {
    const readings = SCOUT_CHECKS.map((check) => ({
      check,
      value: factors[check.key],
      weight: weights[check.key],
    }));
    // Every number the shares need must be real; one malformed entry voids
    // the breakdown rather than silently reweighting the rest.
    if (
      readings.every(
        ({ value, weight }) => isFiniteNumber(value) && isFiniteNumber(weight),
      )
    ) {
      const values = Object.fromEntries(
        readings.map(({ check, value }) => [check.key, value as number]),
      ) as Record<ScoutCheckKey, number>;
      const weightValues = Object.fromEntries(
        readings.map(({ check, weight }) => [check.key, weight as number]),
      ) as Record<ScoutCheckKey, number>;
      const shares = new Map(
        scoutLiftShares({ factors: values, weights: weightValues }).map((share) => [
          share.key,
          share.percent,
        ]),
      );
      const lifting = readings
        .map(({ check, value }) => ({
          check,
          value: value as number,
          share: shares.get(check.key) ?? 0,
        }))
        .filter(({ share }) => share > 0)
        .sort((a, b) => b.share - a.share);

      if (lifting.length > 0) {
        return lifting.slice(0, 3).map(({ check, value, share }) =>
          highlightFor(check, value, row, Math.round(share)),
        );
      }

      // Nothing above neutral: the score is still ranked, so say what the
      // record does hold rather than pretending something pushed it up. No
      // share — there is no lift to take a share of.
      const readable = readings
        .map(({ check, value }) => ({ check, value: value as number }))
        .filter(({ value }) => value !== SCOUT_NO_READING)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3);
      if (readable.length > 0) {
        return readable.map(({ check, value }) => highlightFor(check, value, row, null));
      }
    }
  }

  // No breakdown and no real readings: say what the record does know.
  const fallback: OpportunityHighlight[] = [];
  const sector = row.sector?.trim();
  if (sector) fallback.push({ label: `Works in ${sector}`, strength: null, sharePct: null });
  const city = row.city?.trim();
  if (city) fallback.push({ label: `Based in ${city}`, strength: null, sharePct: null });
  return fallback;
}

/**
 * One line: the fact if the record holds it, otherwise the check's name and
 * how strong its reading was.
 *
 * The strength word is dropped whenever a fact is available — "£1.4m income:
 * strong" says the same thing twice, once in the engine's voice, and the bar
 * beside the line already carries how much it counted.
 */
function highlightFor(
  check: ScoutCheck,
  value: number,
  row: OpportunityRow,
  sharePct: number | null,
): OpportunityHighlight {
  const fact = factLine(check.key, value, row);
  return fact !== null
    ? { label: fact, strength: null, sharePct }
    : { label: check.label, strength: strengthWord(value), sharePct };
}

/**
 * What the check found, in the words of the job — or null where the record
 * does not hold it and the check's own name has to stand in.
 *
 * Deliberately no internal names: a sector is named as the sector, a filing as
 * the year of the accounts, an outreach state as the thing that happened
 * ("Replied to us"), never as the stored status.
 */
function factLine(
  key: ScoutCheckKey,
  value: number,
  row: OpportunityRow,
): string | null {
  switch (key) {
    // Sector and city are already on the card as identity ("Education ·
    // Manchester"), so the line that earns its place here is the judgement:
    // that this is one of the sectors or places the branch prioritises. Both
    // are claimed only above the helping cut — a sector ranked mid-table
    // raised the score a little and is not "a priority sector".
    case "sector": {
      const sector = row.sector?.trim();
      if (!sector) return null;
      return value > SCOUT_HELPING_CUT ? `${sector} is a priority sector` : `Works in ${sector}`;
    }
    case "geography": {
      const city = row.city?.trim();
      if (!city) return null;
      return value > SCOUT_HELPING_CUT ? `${city} is a priority area` : `Based in ${city}`;
    }
    case "size": {
      const income = row.facts?.incomeGBP;
      if (!isFiniteNumber(income)) return null;
      const year = filingYear(row.facts?.incomePeriodEnd);
      return year ? `${formatIncome(income)} income (${year} accounts)` : `${formatIncome(income)} income`;
    }
    case "partnershipHistory": {
      const count = row.facts?.matchedGrantCount;
      if (!isFiniteNumber(count) || count <= 0) return null;
      return count === 1 ? "1 matched grant" : `${count} matched grants`;
    }
    case "previousContact":
      return OUTREACH_FACTS[row.outreach_status] ?? null;
  }
}

/**
 * The outreach stage as the thing that happened, not as the stored status.
 * Every status the scorer recognises is here; an unrecognised one falls back
 * to the check's name rather than inventing a sentence for it.
 */
const OUTREACH_FACTS: Record<string, string> = {
  converted: "Worked with us before",
  future_potential: "Flagged as future potential",
  responded: "Replied to us",
  not_contacted: "Nobody has approached them yet",
  loss_due_timing: "Last time was timing, not a no",
  initial_outreach_sent: "Outreach sent, no reply yet",
  follow_up_sent: "Followed up, no reply yet",
  no_response: "Chased, never replied",
  soft_no: "Said no, politely",
  hard_no: "Asked not to be approached",
};

/** The year of a filing's period end, for the bracket after an income figure. */
function filingYear(periodEnd: string | null | undefined): string | null {
  if (!periodEnd) return null;
  const match = /^(\d{4})/.exec(periodEnd.trim());
  return match ? match[1] : null;
}

/**
 * What the score could not read, in a few words each — "No accounts filed".
 *
 * A card that shows only what lifted a score quietly implies the rest was
 * weighed and found wanting, when often it was never there. Saying so turns a
 * low line into something a CAM can act on: file the accounts, record the
 * sector, and the score means more next time.
 *
 * Reads the persisted `readings` flags where a row has them (a "checked, found
 * nothing" 0.5 and a "never had the data" 0.5 are the same number and only the
 * flags tell them apart), and falls back to the neutral value itself for rows
 * written before those flags existed. Partnership history has no flag by
 * design — F092 treats never-checked and confirmed-zero as one thing — so the
 * value is all there is either way.
 */
export function scoreGaps(row: OpportunityRow): string[] {
  const raw = row.score_factors;
  const factors =
    raw && typeof raw === "object" && raw.factors && typeof raw.factors === "object"
      ? (raw.factors as Partial<Record<ScoutCheckKey, unknown>>)
      : undefined;
  if (!factors) return [];
  const flags = raw?.readings;

  return SCOUT_CHECKS.filter((check) => {
    const flag = flags?.[check.key];
    if (typeof flag === "boolean") return !flag;
    return factors[check.key] === SCOUT_NO_READING;
  }).map((check) => check.gap);
}

/**
 * How strong a 0–1 reading is, in the record page's words
 * (`scoutReadingFor`'s bands, without the subject prefix). Used only where no
 * fact was available to name instead.
 */
function strengthWord(value: number): string {
  if (value >= 0.75) return "strong";
  if (value > SCOUT_HELPING_CUT) return "above average";
  if (value >= 0.45) return "middling";
  if (value >= 0.25) return "weak";
  return "very weak";
}

/**
 * The ranked shortlist: eligible rows sorted by score, highest first, with
 * reasons attached. Ties break alphabetically so the order is stable between
 * reloads.
 *
 * Pass `ownerId` for the personal ("Your") variant: it keeps what the viewer
 * owns plus unclaimed clients they could pick up. Omit it for the team-wide
 * admin variant.
 */
export function selectPriorityOpportunities(
  rows: OpportunityRow[],
  options: { limit?: number; ownerId?: string } = {},
): PriorityOpportunity[] {
  const { limit = PRIORITY_OPPORTUNITIES_LIMIT, ownerId } = options;
  const excluded = new Set(EXCLUDED_OPPORTUNITY_STATUSES);

  return rows
    .filter((row) => {
      if (!isFiniteNumber(row.priority_score)) return false;
      if (excluded.has(row.outreach_status)) return false;
      if (ownerId !== undefined && row.owner_id !== ownerId && row.owner_id !== null) {
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        (b.priority_score as number) - (a.priority_score as number) ||
        a.legal_name.localeCompare(b.legal_name),
    )
    .slice(0, Math.max(limit, 0))
    .map((row) => ({
      ...row,
      displayScore: formatPriorityScore(row.priority_score as number),
      highlights: scoreHighlights(row),
      gaps: scoreGaps(row),
      // The register's own words, resolved the one canonical way
      // (`src/lib/mission.ts`) rather than the card picking a column.
      mission: resolveMissionText(row),
    }));
}

/**
 * Second pass: hand the ranked few their figures and rebuild their lines.
 *
 * The order is deliberate — rank first on what the page already fetched, then
 * read income and grant counts for the six ids that survived, the same way the
 * card's missions are fetched. Reading them for every client to use six would
 * cost the dashboard two whole-table reads for a card that shows six rows.
 *
 * An id absent from `factsById` simply keeps the lines it already had.
 */
export function applyOpportunityFacts(
  opportunities: PriorityOpportunity[],
  factsById: Map<string, OpportunityFacts>,
): PriorityOpportunity[] {
  return opportunities.map((opportunity) => {
    const facts = factsById.get(opportunity.id);
    if (!facts) return opportunity;
    const withFacts = { ...opportunity, facts };
    return { ...withFacts, highlights: scoreHighlights(withFacts) };
  });
}
