import { SectionCard } from "./section-card";
import type { ScoreFactorsRecord } from "@/lib/scoring/persist-latest-score.ts";

/**
 * F095 (#94) — Score Breakdown.
 *
 * Answers the CAM's "why does this client score what it scores?" straight on
 * the profile: each parameter's contribution to the final number as a
 * percentage of the score plus a plain-English line. Percentages rather than
 * raw 0–1 factor values because the audience is CAMs, not the engine —
 * "sector contributed 18%" is actionable; "sector = 0.9 × 0.2" is not.
 *
 * The numbers come from LATEST_SCORES.score_factors — the inputs persisted in
 * the same write as the score — so what this card shows always adds up to the
 * displayed priority_score by construction (AC3). Nothing here recomputes.
 *
 * Neutral handling matters as much as signal: 0.5 is the engine's explicit
 * "no usable data" value for every factor, and presenting it as if it were a
 * real judgement would be exactly the trust damage this ticket exists to fix.
 * A neutral factor says so, and geography additionally carries an honest
 * footnote until branch-level priority regions exist (see score-client.ts's
 * FACTOR COVERAGE header).
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
  /** What 0.5 honestly means for this parameter. */
  neutralNote: string;
}[] = [
  {
    key: "sector",
    label: "Sector",
    neutralNote: "No classified sector on record yet",
  },
  {
    key: "geography",
    label: "Geography",
    neutralNote: "Branch regions not configured — dormant",
  },
  {
    key: "size",
    label: "Size",
    neutralNote: "No income figures on record",
  },
  {
    key: "partnershipHistory",
    label: "Partnership history",
    neutralNote: "No previous grants recorded",
  },
  {
    key: "previousContact",
    label: "Previous contact",
    neutralNote: "No outreach history yet",
  },
];

/**
 * The engine normalises by the weight sum, so each factor's share of the final
 * score is (factor × weight) / Σ(factor × weight) — these sum to the stored
 * score exactly, which is what AC3 asks the card to prove visually.
 */
function contributions(row: NonNullable<LatestScoreDetailRow["score_factors"]>) {
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
  if (factorValue > 0.55) {
    return { barClass: "bg-brand", textClass: "text-brand-hover" };
  }
  if (factorValue < 0.45) {
    return { barClass: "bg-black/30", textClass: "text-foreground/60" };
  }
  return { barClass: "bg-black/[0.14]", textClass: "text-foreground/45" };
}

export function ScoreBreakdownCard({
  score,
  band,
  factors,
  error,
}: {
  score: number | null;
  band: string | null;
  factors: LatestScoreDetailRow["score_factors"];
  error: boolean;
}) {
  return (
    <SectionCard
      headingId="score-breakdown-heading"
      title="Priority score"
      hint="Why this client ranks where it does — each parameter's share of the score."
      action={
        score !== null && band !== null ? (
          <span className="rounded-full bg-brand/10 px-3 py-1.5 text-[13px] font-bold tabular-nums text-brand-hover">
            {score.toFixed(2)} · {band}
          </span>
        ) : undefined
      }
    >
      {error ? (
        <p className="mt-4 text-sm font-bold text-destructive" role="alert">
          The score breakdown could not be loaded. Refresh and try again.
        </p>
      ) : score === null ? (
        <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
          Not scored yet. This client is scored automatically once its record has
          enough data — nothing needs doing here.
        </p>
      ) : !factors ? (
        <div className="mt-4 space-y-2 text-sm leading-[1.7] text-foreground/45">
          <p>
            Scored before per-parameter breakdowns were recorded, so the split
            below isn&apos;t available for this row yet.
          </p>
          <p className="text-[13px] text-foreground/35">
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

  return (
    <div className="mt-4">
      <ul className="space-y-3">
        {FACTOR_ROWS.map(({ key, label, neutralNote }) => {
          const value = factors.factors[key];
          const percent = shares.get(key) ?? 0;
          // The engine's explicit no-data value: report it as such instead of
          // dressing a neutral up as a judgement. 0.5 survives the jsonb round
          // trip exactly (binary-representable), so equality is safe.
          const isNeutral = value === 0.5;
          const tone = toneFor(value);
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-bold text-foreground/80">
                  {label}
                </p>
                <p
                  className={`shrink-0 text-[12px] font-bold tabular-nums ${tone.textClass}`}
                  title={`${label} contributes ${percent.toFixed(1)}% of the score`}
                >
                  {isNeutral ? "—" : `${percent.toFixed(0)}%`}
                </p>
              </div>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.05]"
                role="img"
                aria-label={`${label}: ${isNeutral ? neutralNote : `${percent.toFixed(0)}% of the score`}`}
              >
                <div
                  className={`h-full rounded-full ${tone.barClass}`}
                  style={{ width: `${Math.min(100, percent)}%` }}
                />
              </div>
              <p className="mt-1 text-[12px] leading-[1.6] text-foreground/40">
                {isNeutral ? neutralNote : reasonFor(key, value)}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 border-t border-black/[0.05] pt-3 text-[12px] leading-[1.6] text-foreground/35">
        Geography stays neutral until branch priority regions are configured.
        Percentages are each parameter&apos;s share of the final score and add up
        to it.
      </p>
    </div>
  );
}

function reasonFor(key: FactorKey, value: number): string {
  const direction =
    value > 0.55
      ? "in this client's favour"
      : value < 0.45
        ? "holding this client back"
        : "broadly neutral";
  switch (key) {
    case "sector":
      return `Sector fit ${direction} against the branch's sector priorities.`;
    case "geography":
      return `Location ${direction}.`;
    case "size":
      return `Income size ${direction}.`;
    case "partnershipHistory":
      return `Previous grants ${direction}.`;
    case "previousContact":
      return `Outreach history ${direction}.`;
  }
}
