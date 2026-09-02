"use client";

import type { ReactNode } from "react";
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

/**
 * The five checks, once.
 *
 * This was two arrays — the card called them "Sector / Geography / Size /
 * Partnership history / Previous contact" and the dialog explaining the card
 * called the same five "What they do / Where they are / How big they are / Who
 * has funded them / Where we got to before". A panel whose entire job is
 * explaining the card behind it was making the reader build the mapping
 * themselves, and `priority-dial.tsx` in the header was a third vocabulary
 * (it agrees with the card, so the card's names won).
 *
 * `reads` is where the plain-English phrasing survives: a short sentence under
 * the name, which is a better home for it than a label that also has to fit a
 * narrow card row and a dial legend.
 */
const CHECKS: {
  key: FactorKey;
  /** The one name for this check, used here, on the card, and in the dial. */
  label: string;
  /** What the check looks at, in one sentence. */
  reads: string;
  /** What pushes this check up. */
  raises: string;
  /** What pushes it down. */
  lowers: string;
  /** What we can say when the check found nothing at all. */
  blank: string;
  /** Names the input this parameter reads, for the "we do have something" case. */
  subject: string;
}[] = [
  {
    key: "sector",
    label: "Sector",
    reads: "The sector the organisation works in.",
    raises:
      "Health and wellbeing rates highest, then education and youth, then poverty and community work.",
    lowers: "Arts, heritage and environmental work sit lower down the list.",
    blank: "No sector recorded, so this check found nothing to go on.",
    subject: "Sector fit against the branch's priorities",
  },
  {
    key: "geography",
    label: "Geography",
    reads:
      "Whether the organisation sits in one of the branch's priority areas.",
    raises: "Being inside a priority area.",
    lowers: "Being outside every priority area.",
    blank:
      "Nobody has set the branch's priority areas yet, so this check is asleep for every client — it is not something wrong with this record.",
    subject: "Location against the branch's priority regions",
  },
  {
    key: "size",
    label: "Size",
    reads: "The income on their most recent set of published accounts.",
    raises: "Income over £1m rates highest; £100k–£1m is solid.",
    lowers:
      "Under £10k rates lowest — a small organisation is a smaller opportunity.",
    blank:
      "No accounts with an income figure have been filed against this record.",
    subject: "Income size",
  },
  {
    key: "partnershipHistory",
    label: "Partnership history",
    reads: "How many grants we can match to them in the public 360Giving data.",
    raises: "Five or more matched grants rates highest.",
    lowers:
      "Nothing here counts against a client — it either helps or stays neutral.",
    blank: "No grants matched to this organisation.",
    subject: "Previous grant history",
  },
  {
    key: "previousContact",
    label: "Previous contact",
    reads:
      "The stage they reached with us last time, and how long ago that was.",
    raises:
      "Already converted rates highest, then flagged as future potential, then replied to us. A client nobody has approached yet also rates well — the opportunity is untouched.",
    lowers:
      "A hard no floors it. Soft no and gone quiet sit low, and anything we are still waiting on slides down the longer the silence runs, over about a month.",
    blank: "No outreach recorded against this client yet.",
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
  const parts = CHECKS.map(({ key }) => ({
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

/**
 * One check's verdict — the same four states wherever they are drawn.
 *
 * They used to be four labels in three colours, and the collision was in the
 * worst possible place: "Neither way" and "Holding it back" were both
 * `text-dim` with a `bg-faint` dot, pixel for pixel, so the two states a CAM
 * most needs to tell apart could only be told apart by reading. "Nothing on
 * record" was a filled dot one shade lighter again, which drew absence as a
 * pale reading rather than as no reading.
 *
 * Now: `--lead` for a check that is helping (the record's structural accent,
 * already how this card draws signal), `--hold` for one that is holding the
 * score back — amber is the palette's "worth knowing, not an error", which is
 * exactly what a weak input is — plain grey for genuinely middling, and an
 * *outline* dot for nothing on record, because an empty ring is the one shape
 * that reads as absence at 6px rather than as a dimmer value.
 */
function verdictFor(value: number): {
  label: string;
  textClass: string;
  dotClass: string;
  barClass: string;
} {
  // 0.5 survives the jsonb round trip exactly (binary-representable), so
  // equality against the engine's no-data constant is safe.
  if (value === 0.5) {
    return {
      label: "Nothing on record",
      textClass: "text-faint",
      dotClass: "border border-faint/70 bg-transparent",
      barClass: "bg-rule",
    };
  }
  if (value > 0.55) {
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
  const covered = CHECKS.filter(
    ({ key }) => factors.factors[key] !== 0.5,
  ).length;

  return (
    <>
      <p className="mt-3 text-[12.5px] leading-[1.5] text-dim">
        <span className="font-semibold text-ink">
          {covered} of {CHECKS.length} checks found something.
        </span>{" "}
        {covered === CHECKS.length
          ? "Every check is a real reading."
          : `The rest count as half a mark each, which is what keeps a thin record near the middle of the range rather than at either end.`}
      </p>
      <ul className="mt-2.5 space-y-2">
        {CHECKS.map(({ key, label, blank, subject }) => {
          const value = factors.factors[key];
          const percent = shares.get(key) ?? 0;
          const isNeutral = value === 0.5;
          const verdict = verdictFor(value);

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
                        className={`shrink-0 font-mono text-[12px] font-medium tabular-nums ${verdict.textClass}`}
                      >
                        {percent.toFixed(0)}%
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="mt-1.5 block h-[5px] overflow-hidden rounded-full bg-paper-sunk"
                    >
                      <span
                        className={`block h-full rounded-full ${verdict.barClass}`}
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
                      ? blank
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
 * How the five checks are balanced, said in words. Equal weighting is the
 * normal state and deserves one plain sentence; anything else is an admin's
 * deliberate change, and the reader needs to know which check was favoured
 * rather than a column of decimals.
 */
function weightingSentence(weights: ScoreFactorsRecord["weights"]): string {
  const values = CHECKS.map(({ key }) => weights[key]);
  const first = values[0];
  if (values.every((value) => Math.abs(value - first) < 0.0001)) {
    return "All five checks currently count equally.";
  }
  const heaviest = CHECKS.reduce((top, row) =>
    weights[row.key] > weights[top.key] ? row : top,
  );
  const lightest = CHECKS.reduce((low, row) =>
    weights[row.key] < weights[low.key] ? row : low,
  );
  return `The checks are not balanced equally right now — “${heaviest.label}” counts for the most and “${lightest.label}” for the least. This can be edited by an admin.`;
}

/** A section head with the hairline that separates it from what came before. */
function MethodHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 border-t border-rule-soft pt-5 text-[15px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
      {children}
    </h3>
  );
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
 * first version was a spec sheet: a four-column arithmetic table, the raw 0–1
 * reading and weight for each factor, and the source filename beside each one.
 * The version after that was the same spec sheet in prose — every row printed
 * what raises the check and what lowers it, permanently, above the fold, so the
 * panel opened on reference material instead of on the answer.
 *
 * What it does now, in the order a reader wants it: the verdict on this client
 * for each check, with its share of the score right-aligned beside it, and the
 * scale behind it folded away under "What moves this check" for the one row
 * being questioned. Reference on demand, not reference by default.
 *
 * The half-mark rule is stated once. It was in every neutral row, in its own
 * section, and in the card's coverage line — three tellings of the single most
 * repeated sentence in the panel. The section keeps it, because that is where
 * someone goes when they doubt the number.
 */
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
              underneath. Frosted rather than solid: the body blurs through it
              as it scrolls under. The close is inside the bar — an absolutely
              positioned one anchors to the scroll container and scrolls away
              with it. */}
          <div className="sticky top-0 z-20 rounded-t-[16px] border-b border-rule-soft bg-white/85 px-6 pt-5 pb-4 backdrop-blur-[4px] backdrop-saturate-150">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <MorphingDialogTitle>
                  <h2 className="text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                    How the priority score works
                  </h2>
                </MorphingDialogTitle>
                <MorphingDialogSubtitle>
                  {/* One premise, said once: the paragraph under the header
                      used to restate this sentence in longer form. */}
                  <p className="mt-1 text-[13px] leading-[1.5] text-dim">
                    Five checks on the record, averaged into one number between
                    0.00 and 1.00.
                  </p>
                </MorphingDialogSubtitle>
              </div>

              {/* MorphingDialogClose forwards no event props, so `asChild` (the
                  auth-dialog pattern) silently loses the hover/tap handlers and
                  the strokes never move. Inside-out instead: the animated span
                  fills the 32px button, so the hover target is still the whole
                  pad. */}
              <MorphingDialogClose className="static flex size-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid">
                <AnimateIcon
                  animateOnHover
                  animateOnTap
                  className="flex size-full items-center justify-center"
                >
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
                  transition: {
                    duration: 0.42,
                    delay: 0.08,
                    ease: [0.32, 0.72, 0, 1],
                  },
                },
                exit: {
                  opacity: 0,
                  scale: 0.985,
                  y: 20,
                  transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
                },
              }}
            >
              <p className="rounded-inset bg-paper px-4 py-3.5 text-[13px] leading-[1.6] text-dim">
                Nothing here is a guess or a prediction. Every check reads
                something already on the record — sector, location, published
                accounts, grant history, our own outreach — so the same record
                always produces the same score, and you can see exactly which
                fact moved it.
                {factors ? ` ${weightingSentence(factors.weights)}` : ""}
              </p>

              <MethodHeading>The five checks</MethodHeading>
              <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                {factors
                  ? "What each one looks at, and what it found on this client."
                  : "What each one looks at."}
              </p>

              <ul className="mt-3 space-y-2">
                {CHECKS.map((row) => {
                  const value = factors ? factors.factors[row.key] : null;
                  const verdict = value === null ? null : verdictFor(value);
                  const isBlank = value === 0.5;
                  const percent = shares?.get(row.key);

                  return (
                    <li
                      key={row.key}
                      className="rounded-inset border border-rule-soft px-3.5 py-3"
                    >
                      {/* Name and share on one baseline, share right-aligned
                          and tabular — the same shape the card uses, so the two
                          surfaces read as one thing. It used to trail the
                          verdict as prose after a middot, which put the panel's
                          most decision-relevant number last in a sentence. */}
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-[14px] font-semibold text-ink">
                          {row.label}
                        </span>
                        {percent !== undefined && !isBlank && (
                          <span
                            className={`shrink-0 font-mono text-[12px] font-medium tabular-nums ${verdict?.textClass ?? "text-dim"}`}
                          >
                            {percent.toFixed(0)}%
                          </span>
                        )}
                      </div>

                      {verdict && (
                        <span
                          className={`mt-1 inline-flex items-center gap-1.5 text-[11.5px] font-medium ${verdict.textClass}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`size-1.5 rounded-full ${verdict.dotClass}`}
                          />
                          {verdict.label}
                        </span>
                      )}

                      <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
                        {isBlank ? row.blank : row.reads}
                      </p>

                      {/* Native disclosure rather than state: the panel is
                          already animating, and what raises or lowers a check
                          is reference material for the one row someone is
                          arguing with — not something every row should open
                          holding. */}
                      <details className="group mt-2">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid [&::-webkit-details-marker]:hidden">
                          <span
                            aria-hidden="true"
                            className="inline-block transition-transform group-open:rotate-90"
                          >
                            ›
                          </span>
                          What moves this check
                        </summary>
                        <dl className="mt-1.5 space-y-1 text-[12.5px] leading-[1.5]">
                          <div className="flex gap-2">
                            <dt className="w-[5.5rem] shrink-0 text-faint">
                              Scores well
                            </dt>
                            <dd className="min-w-0 text-dim">{row.raises}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-[5.5rem] shrink-0 text-faint">
                              Scores badly
                            </dt>
                            <dd className="min-w-0 text-dim">{row.lowers}</dd>
                          </div>
                        </dl>
                      </details>
                    </li>
                  );
                })}
              </ul>

              <MethodHeading>When we don&apos;t know something</MethodHeading>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-dim">
                A check with nothing to read counts as half a mark rather than
                being skipped. Skipping it would let one known fact carry the
                whole score — a client we know nothing about but have never
                contacted would come out top of the list on that alone. Half a
                mark keeps a thin record in the middle, where it belongs. It
                also means two clients on the same score are not the same bet if
                one had five real readings behind it and the other had one,
                which is what the count at the top of the card is telling you.
              </p>

              <MethodHeading>What the number means</MethodHeading>
              <ul className="mt-2.5 space-y-1">
                {BAND_ROWS.map((band) => {
                  const isCurrent = score !== null && band.test(score);
                  return (
                    <li
                      key={band.label}
                      className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-inset px-2.5 py-1.5 text-[12.5px] ${
                        isCurrent ? "bg-lead-wash text-lead" : "text-dim"
                      }`}
                    >
                      <span
                        className={`font-semibold ${isCurrent ? "" : "text-ink"}`}
                      >
                        {band.label}
                      </span>
                      <span className="font-mono tabular-nums">
                        {band.range}
                      </span>
                      <span className="w-full text-[12px] sm:w-auto">
                        — {band.meaning}
                        {isCurrent && " This client."}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-5 text-[11.5px] leading-[1.55] text-faint">
                The readings above are the ones saved when this client was last
                scored, so they always add up to the score on the card. Scores
                refresh on their own as the record changes — there is nothing to
                run here.
              </p>
            </MorphingDialogDescription>
          </div>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}
