/**
 * The five SCOUT checks, once.
 *
 * The record page's breakdown card, its method dialog, the header dial and
 * the dashboard opportunity cards all explain the same five checks. They used
 * to do it in three vocabularies — the breakdown card called them
 * "Sector / Geography / Size / Partnership history / Previous contact", the
 * method dialog called the same five "What they do / Where they are / How big
 * they are / Who has funded them / Where we got to before", and the dial was
 * a third. A reader had to build the mapping themselves, so the card's names
 * won and every surface reads them from here.
 *
 * What lives here is language and arithmetic only — no JSX, no motion — so
 * server components and `node --test` can use it directly. Dialog-specific
 * prose (weighting sentences, band tables) stays with the dialog.
 *
 * Relative, not "@/lib/...": this module runs under `node --test`, which does
 * not read Next's tsconfig path aliases.
 */
import type { ScoreFactorsRecord } from "./persist-latest-score.ts";

export type ScoutCheckKey = keyof ScoreFactorsRecord["factors"];

export type ScoutCheck = {
  key: ScoutCheckKey;
  /** The one name for this check, used on every surface. */
  label: string;
  /** Concise hint explaining what the criterion evaluates and its scoring relevance. */
  hint: string;
  /** What the check looks at, in one sentence. */
  reads: string;
  /** What pushes this check up. */
  raises: string;
  /** What pushes it down. */
  lowers: string;
  /** What we can say when the check found nothing at all. */
  blank: string;
  /**
   * The same absence in a few words, for a card with no room for `blank` —
   * "No sector recorded". Names the missing record, never the column.
   */
  gap: string;
  /** Names the input this parameter reads, for the "we do have something" case. */
  subject: string;
};

export const SCOUT_CHECKS: ScoutCheck[] = [
  {
    key: "sector",
    label: "Sector",
    hint: "Alignment with branch focus areas and cause priorities",
    reads: "The sector the organisation works in.",
    raises: "Working in a sector ranked near the top in score settings.",
    lowers: "Working in a sector ranked near the bottom in score settings.",
    blank: "No sector recorded, so this check found nothing to go on.",
    gap: "No sector recorded",
    subject: "Sector fit against the branch's priorities",
  },
  {
    key: "geography",
    label: "Geography",
    hint: "Proximity to branch target operating regions",
    reads:
      "Whether the organisation sits in one of the branch's priority areas.",
    raises: "Being inside a priority area.",
    lowers: "Being outside every priority area.",
    blank: "No town or city recorded, so this check found nothing to go on.",
    gap: "No town or city recorded",
    subject: "Location against the branch's priority regions",
  },
  {
    key: "size",
    label: "Size",
    hint: "Operating income scale from latest filed accounts",
    reads: "The income on their most recent set of published accounts.",
    raises: "An income band scored highly in score settings.",
    lowers: "An income band scored low in score settings.",
    blank:
      "No accounts with an income figure have been filed against this record.",
    gap: "No accounts filed",
    subject: "Income size",
  },
  {
    key: "partnershipHistory",
    label: "Partnership history",
    hint: "Track record of matched grant funding in 360Giving",
    reads: "How many grants we can match to them in the public 360Giving data.",
    raises: "Five or more matched grants rates highest.",
    lowers:
      "Nothing here counts against a client: it either helps or stays neutral.",
    blank: "No grants matched to this organisation.",
    gap: "No matched grants",
    subject: "Previous grant history",
  },
  {
    key: "previousContact",
    label: "Previous contact",
    hint: "Stage reached in prior outreach and relationship history",
    reads:
      "The stage they reached with us last time, and how long ago that was.",
    raises:
      "Already converted rates highest, then flagged as future potential, then replied to us. A client nobody has approached yet also rates well — the opportunity is untouched.",
    lowers:
      "A hard no floors it. Soft no and gone quiet sit low, and anything we are still waiting on slides down the longer the silence runs, over about a month.",
    blank: "No outreach recorded against this client yet.",
    gap: "No outreach recorded",
    subject: "Outreach history",
  },
];

/** A check with nothing to read. Explicit, and safe to compare exactly: 0.5
 * survives the jsonb round trip (binary-representable). */
export const SCOUT_NO_READING = 0.5;

/** Above this a check is genuinely pushing the score up. */
export const SCOUT_HELPING_CUT = 0.55;

/**
 * The engine normalises by the weight sum, so each factor's share of the final
 * score is (factor × weight) / Σ(factor × weight) — these sum to the stored
 * score exactly.
 */
export function scoutContributions(row: {
  factors: Record<ScoutCheckKey, number>;
  weights: Record<ScoutCheckKey, number>;
}): { key: ScoutCheckKey; percent: number }[] {
  const parts = SCOUT_CHECKS.map(({ key }) => ({
    key,
    weighted:
      Math.max(0, Math.min(1, row.factors[key])) * Math.max(0, row.weights[key]),
  }));
  const total = parts.reduce((sum, part) => sum + part.weighted, 0);
  return parts.map((part) => ({
    key: part.key,
    percent: total === 0 ? 0 : (part.weighted / total) * 100,
  }));
}

/**
 * How much of the *lift* each check is responsible for — what actually pushed
 * this score above a record with nothing on it.
 *
 * `scoutContributions` answers a different question: what the score is made
 * of. Because it divides weighted value by the weighted total, a check sitting
 * on the neutral 0.5 ("nothing on record") still comes back holding a fifth of
 * the score under equal weights. That is honest as composition and wrong as a
 * reason — a card headed "why it scores highly" must not print 19% next to an
 * empty check.
 *
 * So lift measures each check against the neutral instead of against zero:
 *
 *     lift  = max(0, factor − 0.5) × weight
 *     share = lift / Σ lift
 *
 * A neutral or below-neutral check contributes exactly 0 and drops out; the
 * shares that remain sum to 100 across only the checks doing the lifting. Use
 * this wherever the question is "what raised this", and `scoutContributions`
 * wherever it is "what is this number made of" (the record page's breakdown).
 */
export function scoutLiftShares(row: {
  factors: Record<ScoutCheckKey, number>;
  weights: Record<ScoutCheckKey, number>;
}): { key: ScoutCheckKey; percent: number }[] {
  const parts = SCOUT_CHECKS.map(({ key }) => ({
    key,
    lift:
      Math.max(0, Math.min(1, row.factors[key]) - SCOUT_NO_READING) *
      Math.max(0, row.weights[key]),
  }));
  const total = parts.reduce((sum, part) => sum + part.lift, 0);
  return parts.map((part) => ({
    key: part.key,
    percent: total === 0 ? 0 : (part.lift / total) * 100,
  }));
}

export type ScoutVerdict = {
  label: string;
  textClass: string;
  dotClass: string;
  barClass: string;
};

/**
 * One check's verdict — the same four states wherever they are drawn.
 *
 * `--lead` for a check that is helping (the structural accent, already how
 * the breakdown draws signal), `--hold` for one holding the score back —
 * amber is the palette's "worth knowing, not an error", exactly what a weak
 * input is — plain grey for genuinely middling, and an *outline* dot for
 * nothing on record, because an empty ring is the one shape that reads as
 * absence at 6px rather than as a dimmer value.
 */
export function scoutVerdictFor(value: number): ScoutVerdict {
  if (value === SCOUT_NO_READING) {
    return {
      label: "Nothing on record",
      textClass: "text-faint",
      dotClass: "border border-faint/70 bg-transparent",
      barClass: "bg-rule",
    };
  }
  if (value > SCOUT_HELPING_CUT) {
    return {
      label: "Helping the score",
      textClass: "text-lead",
      dotClass: "bg-lead",
      barClass: "bg-lead",
    };
  }
  if (value >= 0.45) {
    return {
      label: "Neither way",
      textClass: "text-dim",
      dotClass: "bg-faint",
      barClass: "bg-faint/60",
    };
  }
  return {
    label: "Holding it back",
    textClass: "text-hold",
    dotClass: "bg-hold",
    barClass: "bg-hold/70",
  };
}

/**
 * The factor is a 0–1 reading, so the headline says how strong it is rather
 * than only which way it leans — "weak" and "barely below neutral" are not the
 * same news.
 */
export function scoutReadingFor(subject: string, value: number): string {
  if (value >= 0.75) return `${subject}: strong.`;
  if (value > SCOUT_HELPING_CUT) return `${subject}: above average.`;
  if (value >= 0.45) return `${subject}: middling.`;
  if (value >= 0.25) return `${subject}: weak.`;
  return `${subject}: very weak.`;
}
