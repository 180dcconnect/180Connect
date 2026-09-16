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
  scoutContributions,
  SCOUT_HELPING_CUT,
  SCOUT_NO_READING,
  type ScoutCheckKey,
} from "./scoring/scout-checks.ts";
import { resolveMissionText } from "./mission.ts";

export type OpportunityFactors = {
  sector: number;
  geography: number;
  size: number;
  partnershipHistory: number;
  previousContact: number;
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
  } | null;
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
  /** What pushes this score up, strongest weight-aware share first. */
  highlights: OpportunityHighlight[];
  /** Resolved mission text for the card; absent when the record holds none. */
  mission?: string | null;
};

/**
 * One line under "why it scores highly": a canonical check name, how strong
 * its reading is, and the weight-aware share of the final score behind it —
 * the breakdown card's row shape in miniature, so the two surfaces read as
 * one thing.
 */
export type OpportunityHighlight = {
  /** Canonical check name, e.g. "Sector" — the record page's word. */
  label: string;
  /** Reading strength, e.g. "strong" — null when the line is fallback context. */
  strength: string | null;
  /** Share of the final score, 0–100 — null when there is no breakdown. */
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
 * What pushes one opportunity's score up, strongest weight-aware share first,
 * at most three lines.
 *
 * Deliberately not exhaustive: the card answers "what is pulling this number
 * up", and only checks genuinely helping (> 0.55, the record page's own cut)
 * qualify. Neutrals (exactly 0.5, "nothing on record") are absence, not a
 * reason, and never appear. The record page's breakdown table carries all
 * five checks for the moment someone questions the number.
 *
 * Ordering is by share of the final score, not raw factor value: a 0.9
 * reading on a lightly-weighted check moves the number less than a 0.7 on a
 * heavy one, and the card must rank what moved the number. Shares come from
 * the persisted factors *and* weights, so they reproduce the stored score.
 *
 * Without a usable breakdown, falls back to what the record itself says
 * (sector, city) so the card never renders a bare score with no context.
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
        scoutContributions({ factors: values, weights: weightValues }).map((share) => [
          share.key,
          share.percent,
        ]),
      );
      const candidates = readings
        .filter(({ value }) => (value as number) !== SCOUT_NO_READING)
        .map(({ check, value }) => ({
          check,
          value: value as number,
          share: shares.get(check.key) ?? 0,
        }))
        .sort((a, b) => b.share - a.share);
      const helping = candidates.filter(({ value }) => value > SCOUT_HELPING_CUT);
      // A score with nothing actively helping it is still ranked, so show
      // the top real readings with honest strength words rather than
      // pretending something pushed it up.
      const picked = (helping.length > 0 ? helping : candidates).slice(0, 3);
      if (picked.length > 0) {
        return picked.map(({ check, value, share }) => ({
          label: check.label,
          strength: strengthWord(value),
          sharePct: Math.round(share),
        }));
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
 * How strong a 0–1 reading is, in the record page's words
 * (`scoutReadingFor`'s bands, without the subject prefix).
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
      // The register's own words, resolved the one canonical way
      // (`src/lib/mission.ts`) rather than the card picking a column.
      mission: resolveMissionText(row),
    }));
}
