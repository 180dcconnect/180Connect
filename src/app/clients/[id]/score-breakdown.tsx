"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip";
import type { ScoreFactorsRecord } from "@/lib/scoring/persist-latest-score.ts";

import { SectionCard } from "./section-card";

/**
 * F095 (#94) — Score Breakdown.
 *
 * Answers the CAM's "why does this client score what it scores?" straight on
 * the profile: each parameter's contribution to the final number as a
 * percentage of the score. Percentages rather than raw 0–1 factor values
 * because the audience is CAMs, not the engine — "sector contributed 18%" is
 * actionable; "sector = 0.9 × 0.2" is not.
 *
 * The number itself, and the same split drawn as a ring, live in the record
 * header (`priority-dial.tsx`). This card is the readable form of it: named
 * rows, exact percentages, and the reason behind each one.
 *
 * The numbers come from LATEST_SCORES.score_factors — the inputs persisted in
 * the same write as the score — so what this card shows always adds up to the
 * displayed priority_score by construction (AC3). Nothing here recomputes.
 *
 * Neutral handling matters as much as signal: 0.5 is the engine's explicit
 * "no usable data" value for every factor, and presenting it as if it were a
 * real judgement would be exactly the trust damage this ticket exists to fix.
 * A neutral factor is greyed and says why on hover (see score-client.ts's
 * FACTOR COVERAGE header — geography is neutral for every client until
 * branch-level priority regions are wired in).
 *
 * It still shows its percentage, though, which it did not use to: printing "—"
 * there understated the card against the ring in the header, where a neutral
 * parameter visibly occupies arc. It does occupy score — padding a missing
 * factor to 0.5 is a deliberate shrinkage, not an exclusion — so hiding the
 * number made the visible percentages fail to add up to 100 with no explanation.
 * The coverage line above the rows is the honest version of that: it says how
 * much of this score is evidence rather than padding.
 *
 * The "why" is a tooltip on the row rather than a line of prose under it. Five
 * permanent explanatory sentences turned a five-row card into a wall of text
 * that read as filler the second time you saw it — and the explanation is only
 * wanted for the one row you are questioning. Hover or focus a row and it tells
 * you what that parameter found; the phrasing changes with the value, so a
 * missing input says what is missing and a real reading says how strong it is.
 */

export type LatestScoreDetailRow = {
  priority_score: number | null;
  priority_band: string | null;
  score_factors: ScoreFactorsRecord | null;
};

type FactorKey = keyof ScoreFactorsRecord["factors"];

const FACTOR_ROWS: {
  key: FactorKey;
  label: string;
  /** What 0.5 honestly means for this parameter — the "we have nothing" case. */
  neutralNote: string;
  /** Names the input this parameter reads, for the "we do have something" case. */
  subject: string;
}[] = [
  {
    key: "sector",
    label: "Sector",
    neutralNote: "No classified sector on record yet.",
    subject: "Sector fit against the branch's priorities",
  },
  {
    key: "geography",
    label: "Geography",
    neutralNote:
      "Branch priority regions are not configured, so this parameter is dormant for every client.",
    subject: "Location against the branch's priority regions",
  },
  {
    key: "size",
    label: "Size",
    neutralNote: "No income figures on record.",
    subject: "Income size",
  },
  {
    key: "partnershipHistory",
    label: "Partnership history",
    neutralNote: "No previous grants recorded.",
    subject: "Previous grant history",
  },
  {
    key: "previousContact",
    label: "Previous contact",
    neutralNote: "No outreach history yet.",
    subject: "Outreach history",
  },
];

/**
 * The engine normalises by the weight sum, so each factor's share of the final
 * score is (factor × weight) / Σ(factor × weight) — these sum to the stored
 * score exactly, which is what AC3 asks the card to prove visually.
 */
function contributions(
  row: NonNullable<LatestScoreDetailRow["score_factors"]>,
) {
  const parts = FACTOR_ROWS.map(({ key }) => ({
    key,
    weighted:
      Math.max(0, Math.min(1, row.factors[key])) *
      Math.max(0, row.weights[key]),
  }));
  const total = parts.reduce((sum, part) => sum + part.weighted, 0);
  return parts.map((part) => ({
    key: part.key,
    percent: total === 0 ? 0 : (part.weighted / total) * 100,
  }));
}

function toneFor(factorValue: number): {
  barClass: string;
  textClass: string;
} {
  // The lead colour carries the parameters that are helping; a parameter that
  // is holding the client back is dimmed rather than reddened — it is a weaker
  // input, not an error.
  if (factorValue > 0.55) {
    return { barClass: "bg-lead", textClass: "text-lead" };
  }
  if (factorValue < 0.45) {
    return { barClass: "bg-faint", textClass: "text-dim" };
  }
  return { barClass: "bg-rule", textClass: "text-faint" };
}

export function ScoreBreakdownCard({
  score,
  factors,
  error,
}: {
  score: number | null;
  factors: LatestScoreDetailRow["score_factors"];
  error: boolean;
}) {
  return (
    <SectionCard
      headingId="score-breakdown-heading"
      title={
        score !== null ? `Why it scores ${score.toFixed(2)}` : "Priority score"
      }
    >
      {error ? (
        <p className="mt-3.5 text-sm font-semibold text-stop" role="alert">
          The score breakdown could not be loaded. Refresh and try again.
        </p>
      ) : score === null ? (
        <p className="mt-3.5 text-sm leading-[1.6] text-dim">
          Not scored yet. This client is scored automatically once its record
          has enough data — nothing needs doing here.
        </p>
      ) : !factors ? (
        <div className="mt-3.5 space-y-2 text-sm leading-[1.6] text-dim">
          <p>
            Scored before per-parameter breakdowns were recorded, so the split
            below isn&apos;t available for this row yet.
          </p>
          <p className="text-[13px] text-faint">
            The next scoring sweep repopulates it — no action needed.
          </p>
        </div>
      ) : (
        <BreakdownTable factors={factors} />
      )}
    </SectionCard>
  );
}

function BreakdownTable({ factors }: { factors: ScoreFactorsRecord }) {
  const shares = new Map(contributions(factors).map((c) => [c.key, c.percent]));
  // 0.5 survives the jsonb round trip exactly (binary-representable), so
  // equality against the engine's no-data constant is safe.
  const covered = FACTOR_ROWS.filter(
    ({ key }) => factors.factors[key] !== 0.5,
  ).length;

  return (
    <>
      <p className="mt-3 text-[12.5px] leading-[1.5] text-dim">
        <span className="font-semibold text-ink">
          {covered} of {FACTOR_ROWS.length} parameters have data.
        </span>{" "}
        {covered === FACTOR_ROWS.length
          ? "Every parameter is a real reading."
          : `The rest count as half a reading each, which is what keeps a thin record near the middle of the range rather than at either end.`}
      </p>
      <ul className="mt-2.5 space-y-2">
        {FACTOR_ROWS.map(({ key, label, neutralNote, subject }) => {
          const value = factors.factors[key];
          const percent = shares.get(key) ?? 0;
          // The engine's explicit no-data value: report it as such instead of
          // dressing a neutral up as a judgement. 0.5 survives the jsonb round
          // trip exactly (binary-representable), so equality is safe.
          const isNeutral = value === 0.5;
          const tone = toneFor(value);

          return (
            <li key={key}>
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  {/* A button because it is the one element that is focusable,
                    hoverable and announced everywhere — the row does nothing
                    when clicked, hence `cursor-default`. */}
                  <button
                    type="button"
                    className="w-full cursor-default rounded-inset px-1.5 py-1 text-left transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead-mid"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">
                        {label}
                      </span>
                      <span
                        className={`shrink-0 font-mono text-[12px] font-medium tabular-nums ${tone.textClass}`}
                      >
                        {percent.toFixed(0)}%
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="mt-1.5 block h-[5px] overflow-hidden rounded-full bg-paper-sunk"
                    >
                      <span
                        className={`block h-full rounded-full ${tone.barClass}`}
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={6}
                  className="max-w-[17rem] rounded-inset bg-ink px-3 py-2 text-left text-[12px] leading-[1.5] text-white shadow-lg"
                >
                  <span className="block font-semibold">
                    {isNeutral
                      ? "No reading on this parameter"
                      : readingFor(subject, value)}
                  </span>
                  <span className="mt-0.5 block text-white/70">
                    {isNeutral
                      ? neutralNote
                      : `Contributes ${percent.toFixed(1)}% of the final score.`}
                  </span>
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * The factor is a 0–1 reading, so the headline says how strong it is rather
 * than only which way it leans — "weak" and "barely below neutral" are not the
 * same news, and the old two-way split reported them identically.
 */
function readingFor(subject: string, value: number): string {
  if (value >= 0.75) return `${subject}: strong.`;
  if (value > 0.55) return `${subject}: above average.`;
  if (value >= 0.45) return `${subject}: middling.`;
  if (value >= 0.25) return `${subject}: weak.`;
  return `${subject}: very weak.`;
}
