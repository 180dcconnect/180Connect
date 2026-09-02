"use client";

import { HelpCircle } from "lucide-react";

import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { XIcon } from "@/components/animate-ui/icons/x";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip";
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogSubtitle,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "@/components/core/morphing-dialog";
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
      action={<ScoreMethodDialog factors={factors} score={score} />}
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
          {covered} of {FACTOR_ROWS.length} checks found something.
        </span>{" "}
        {covered === FACTOR_ROWS.length
          ? "Every check is a real reading."
          : `The rest count as half a mark each, which is what keeps a thin record near the middle of the range rather than at either end.`}
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

/**
 * The method behind the card, one click away.
 *
 * The card answers "which parameter moved this number". The question
 * underneath — "0.9 out of what? weighted how? who decided £1m is a 0.9?" — is
 * the one that decides whether a CAM trusts the ranking at all, and until now
 * the only place it was answered was a comment header in `score-client.ts`.
 *
 * Written for the person using the tool, not the person maintaining it. The
 * first version of this dialog was a spec sheet: a four-column arithmetic
 * table, the raw 0–1 reading and weight for each factor, every scale printed
 * as a numeric lookup, and the source filename beside each one. All true, and
 * all aimed at a reader who already knew what a weighted average was. A CAM
 * opening a "?" wants to know whether to trust the ranking and what would move
 * it — so each check now says, in a sentence, what it looks at, what makes it
 * go up, and what this client actually got. The numbers are still there where
 * they carry meaning (income thresholds, the band cut-offs), and gone where
 * they were only the engine talking to itself.
 */

/** One check, as a CAM meets it. Scales mirror the `score-by-*.ts` scorers. */
const METHOD_ROWS: {
  key: FactorKey;
  label: string;
  /** What the check looks at, in one sentence. */
  reads: string;
  /** What pushes this check up. */
  raises: string;
  /** What pushes it down. */
  lowers: string;
  /** What we can say when the check found nothing at all. */
  blank: string;
}[] = [
  {
    key: "sector",
    label: "What they do",
    reads: "The sector the organisation works in.",
    raises:
      "Health and wellbeing rates highest, then education and youth, then poverty and community work.",
    lowers: "Arts, heritage and environmental work sit lower down the list.",
    blank: "No sector recorded, so this check found nothing to go on.",
  },
  {
    key: "geography",
    label: "Where they are",
    reads: "Whether the organisation sits in one of the branch's priority areas.",
    raises: "Being inside a priority area.",
    lowers: "Being outside every priority area.",
    blank:
      "Nobody has set the branch's priority areas yet, so this check is asleep for every client — it is not something wrong with this record.",
  },
  {
    key: "size",
    label: "How big they are",
    reads: "The income on their most recent set of published accounts.",
    raises: "Income over £1m rates highest; £100k–£1m is solid.",
    lowers: "Under £10k rates lowest — a small organisation is a smaller opportunity.",
    blank: "No accounts with an income figure have been filed against this record.",
  },
  {
    key: "partnershipHistory",
    label: "Who has funded them",
    reads: "How many grants we can match to them in the public 360Giving data.",
    raises: "Five or more matched grants rates highest.",
    lowers: "Nothing here counts against a client — it either helps or stays neutral.",
    blank: "No grants matched to this organisation.",
  },
  {
    key: "previousContact",
    label: "Where we got to before",
    reads: "The stage they reached with us last time, and how long ago that was.",
    raises:
      "Already converted rates highest, then flagged as future potential, then replied to us. A client nobody has approached yet also rates well — the opportunity is untouched.",
    lowers:
      "A hard no floors it. Soft no and gone quiet sit low, and anything we are still waiting on slides down the longer the silence runs, over about a month.",
    blank: "No outreach recorded against this client yet.",
  },
];

/** score-client.ts's PRIORITY_BAND_THRESHOLDS, in the same order. */
const BAND_ROWS: {
  label: string;
  range: string;
  meaning: string;
  test: (score: number) => boolean;
}[] = [
  {
    label: "High",
    range: "0.70 and up",
    meaning: "Worth approaching now.",
    test: (score) => score >= 0.7,
  },
  {
    label: "Medium",
    range: "0.40 to 0.69",
    meaning: "Worth a look when the high ones are handled.",
    test: (score) => score >= 0.4 && score < 0.7,
  },
  {
    label: "Low",
    range: "under 0.40",
    meaning: "Leave unless you know something the record doesn't.",
    test: (score) => score < 0.4,
  },
];

/**
 * The verdict on one check, in the words a CAM would use. Deliberately four
 * outcomes rather than a number: "helping" and "holding it back" is what the
 * reader is actually deciding between.
 */
function verdictFor(value: number): { label: string; tone: string; dot: string } {
  if (value === 0.5) {
    return { label: "Nothing on record", tone: "text-faint", dot: "bg-rule" };
  }
  if (value > 0.55) {
    return { label: "Helping the score", tone: "text-lead", dot: "bg-lead" };
  }
  if (value >= 0.45) {
    return { label: "Neither way", tone: "text-dim", dot: "bg-faint" };
  }
  return { label: "Holding it back", tone: "text-dim", dot: "bg-faint" };
}

/**
 * How the five checks are balanced, said in words. Equal weighting is the
 * normal state and deserves one plain sentence; anything else is an admin's
 * deliberate change, and the reader needs to know which check was favoured
 * rather than a column of decimals.
 */
function weightingSentence(weights: ScoreFactorsRecord["weights"]): string {
  const values = FACTOR_ROWS.map(({ key }) => weights[key]);
  const first = values[0];
  if (values.every((value) => Math.abs(value - first) < 0.0001)) {
    return "All five checks currently count equally.";
  }
  const heaviest = METHOD_ROWS.reduce((top, row) =>
    weights[row.key] > weights[top.key] ? row : top,
  );
  const lightest = METHOD_ROWS.reduce((low, row) =>
    weights[row.key] < weights[low.key] ? row : low,
  );
  return `The checks are not balanced equally right now — “${heaviest.label}” counts for the most and “${lightest.label}” for the least. An admin sets this.`;
}

function ScoreMethodDialog({
  score,
  factors,
}: {
  score: number | null;
  factors: LatestScoreDetailRow["score_factors"];
}) {
  const shares = factors
    ? new Map(contributions(factors).map((c) => [c.key, c.percent]))
    : null;

  return (
    // Slower than the primitive's default, and bounceless. At 0.25s with a
    // little bounce the panel snapped open and the eye had nothing to follow —
    // it read as a flash rather than the trigger becoming the panel. 0.5s with
    // bounce 0 is a critically damped spring: it settles once, from the exact
    // rect of the "?" button, so the morph is legible without feeling slack.
    //
    // The trigger is a circle and the panel is 16px, so Motion interpolates the
    // corner radius across the whole morph and the panel spends its first
    // frames with oversized, over-round corners. A fast standalone tween for
    // borderRadius snaps the corners while the box still morphs on the spring.
    <MorphingDialog
      transition={{
        type: "spring",
        bounce: 0,
        duration: 0.5,
        borderRadius: { type: "tween", duration: 0.08 },
      }}
    >
      <MorphingDialogTrigger
        className="flex size-6 items-center justify-center rounded-full border border-rule bg-white text-faint transition-colors hover:border-lead-mid hover:text-lead focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid"
        style={{ borderRadius: "9999px" }}
      >
        <HelpCircle aria-hidden="true" className="size-3.5" />
        <span className="sr-only">How the priority score works</span>
      </MorphingDialogTrigger>

      <MorphingDialogContainer>
        <MorphingDialogContent
          className="pointer-events-auto relative flex max-h-[85vh] w-full flex-col overflow-y-auto border border-rule bg-white sm:w-[560px]"
          style={{ borderRadius: "16px" }}
        >
          {/* Sticky header: the scrolling lives on the dialog content itself,
              so the title bar and close stay pinned while the body passes
              underneath. Frosted rather than solid (the tag picker's glass):
              the body blurs through it as it scrolls under. The close is inside
              the bar — an absolutely-positioned one anchors to the scroll
              container and scrolls away with it. */}
          <div className="sticky top-0 z-20 rounded-t-[16px] border-b border-rule-soft bg-white/75 px-6 pt-5 pb-4 backdrop-blur-[10px] backdrop-saturate-150">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <MorphingDialogTitle>
                  <h2 className="text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                    How the priority score works
                  </h2>
                </MorphingDialogTitle>
                <MorphingDialogSubtitle>
                  <p className="mt-1 text-[13px] leading-[1.5] text-dim">
                    Five checks on the record, averaged into one number between 0.00 and 1.00.
                    Higher means more worth your time.
                  </p>
                </MorphingDialogSubtitle>
              </div>

              {/* MorphingDialogClose forwards no event props, so `asChild` (the
                  auth-dialog pattern) silently loses the hover/tap handlers and
                  the strokes never move. Inside-out instead: the animated span
                  fills the 32px button, so the hover target is still the whole
                  pad. */}
              <MorphingDialogClose className="static flex size-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid">
                <AnimateIcon animateOnHover animateOnTap className="flex size-full items-center justify-center">
                  <XIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                </AnimateIcon>
              </MorphingDialogClose>
            </div>
          </div>

          <div className="px-6 pt-5 pb-7">

            <MorphingDialogDescription
              disableLayoutAnimation
              // The body rides in behind the box rather than with it: the
              // morph owns the first beat, the content settles into the space
              // it made. Delayed in, immediate out — an exit that waits is an
              // exit that feels stuck.
              variants={{
                initial: { opacity: 0, scale: 0.985, y: 20 },
                animate: {
                  opacity: 1,
                  scale: 1,
                  y: 0,
                  transition: { duration: 0.42, delay: 0.08, ease: [0.32, 0.72, 0, 1] },
                },
                exit: {
                  opacity: 0,
                  scale: 0.985,
                  y: 20,
                  transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
                },
              }}
            >
              <p className="mt-4 rounded-inset bg-paper px-4 py-3.5 text-[13px] leading-[1.6] text-dim">
                Nothing here is a guess or a prediction. Every check reads something already
                on the record — sector, location, published accounts, grant history, our own
                outreach — so the same record always produces the same score, and you can see
                exactly which fact moved it.
                {factors ? ` ${weightingSentence(factors.weights)}` : ""}
              </p>

              <h3 className="mt-6 text-[13px] font-semibold tracking-[-0.01em] text-ink">
                The five checks
              </h3>
              <p className="mt-1 text-[12.5px] leading-[1.55] text-dim">
                {factors
                  ? "What each one looks at, and what it found on this client."
                  : "What each one looks at."}
              </p>

              <ul className="mt-2.5 space-y-2.5">
                {METHOD_ROWS.map((row) => {
                  const value = factors ? factors.factors[row.key] : null;
                  const verdict = value === null ? null : verdictFor(value);
                  const isBlank = value === 0.5;
                  const percent = shares?.get(row.key);

                  return (
                    <li
                      key={row.key}
                      className="rounded-inset border border-rule-soft px-3.5 py-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-[13.5px] font-semibold text-ink">{row.label}</span>
                        {verdict && (
                          <span
                            className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium ${verdict.tone}`}
                          >
                            <span
                              aria-hidden="true"
                              className={`size-1.5 rounded-full ${verdict.dot}`}
                            />
                            {verdict.label}
                            {percent !== undefined && !isBlank
                              ? ` · ${percent.toFixed(0)}% of the score`
                              : ""}
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-[12.5px] leading-[1.55] text-dim">{row.reads}</p>

                      {isBlank ? (
                        <p className="mt-1.5 text-[12.5px] leading-[1.55] text-dim">
                          {row.blank} A check with nothing to read counts as a half mark, which
                          is why it still takes up part of the score.
                        </p>
                      ) : (
                        <dl className="mt-2 space-y-1 text-[12.5px] leading-[1.5]">
                          <div className="flex gap-2">
                            <dt className="w-[5.5rem] shrink-0 text-faint">Scores well</dt>
                            <dd className="min-w-0 text-dim">{row.raises}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-[5.5rem] shrink-0 text-faint">Scores badly</dt>
                            <dd className="min-w-0 text-dim">{row.lowers}</dd>
                          </div>
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ul>

              <h3 className="mt-6 text-[13px] font-semibold tracking-[-0.01em] text-ink">
                When we don&apos;t know something
              </h3>
              <p className="mt-1.5 text-[12.5px] leading-[1.6] text-dim">
                A check with nothing to read counts as half a mark rather than being skipped.
                Skipping it would let one known fact carry the whole score — a client we know
                nothing about but have never contacted would come out top of the list on that
                alone. Half a mark keeps a thin record in the middle, where it belongs. It also
                means two clients on the same score are not the same bet if one had five real
                readings behind it and the other had one, which is what the count at the top of
                this card is telling you.
              </p>

              <h3 className="mt-6 text-[13px] font-semibold tracking-[-0.01em] text-ink">
                What the number means
              </h3>
              <ul className="mt-2 space-y-1">
                {BAND_ROWS.map((band) => {
                  const isCurrent = score !== null && band.test(score);
                  return (
                    <li
                      key={band.label}
                      className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-inset px-2.5 py-1.5 text-[12.5px] ${
                        isCurrent ? "bg-lead-wash text-lead" : "text-dim"
                      }`}
                    >
                      <span className={`font-semibold ${isCurrent ? "" : "text-ink"}`}>
                        {band.label}
                      </span>
                      <span className="font-mono tabular-nums">{band.range}</span>
                      <span className="w-full text-[12px] sm:w-auto">
                        — {band.meaning}
                        {isCurrent && " This client."}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-5 text-[11.5px] leading-[1.55] text-faint">
                The readings above are the ones saved when this client was last scored, so they
                always add up to the score on the card. Scores refresh on their own as the
                record changes — there is nothing to run here.
              </p>
            </MorphingDialogDescription>
          </div>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}
