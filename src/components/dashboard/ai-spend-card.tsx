"use client";

import { useState } from "react";
import Link from "next/link";

import { AiSpendActivityGauge } from "@/components/dashboard/ai-spend-activity-gauge";
import { AiSpendDailyChart } from "@/components/dashboard/ai-spend-daily-chart";
import {
  aiSpendActivityRows,
  aiSpendChange,
  aiSpendRangeLabel,
  DEFAULT_AI_SPEND_PERIOD,
  formatShare,
  formatUsd,
  type AiSpendPeriodId,
  type AiSpendReading,
} from "@/lib/dashboard/ai-spend";

/**
 * F213 — AI spend, admin only.
 *
 * `/admin/ai-generations` already answers "what did this email cost". This
 * answers "what are we spending, and is it accelerating", which is the question
 * nobody was asking because nothing on the platform put the number anywhere.
 *
 * **The window is a choice.** The card used to be month-to-date and nothing
 * else, which is the right default — it is the number the budget is usually
 * read against — but a month boundary cuts a question in half: on the 2nd, a
 * "this month" reading is two days of data with nothing behind it to compare
 * with. The dropdown offers the same family of windows as the Total
 * Organisations card, and every window is compared with the equal-length
 * stretch immediately before it, never with a calendar month of a different
 * length.
 *
 * Every window was computed on the server off one fetch (`aiSpendReadings`), so
 * switching is a re-read of figures already in the browser, not a query.
 *
 * Composed in the Data-imports stat-card shape — heading, hint, the reading, the
 * instruments, then the detail — because the old version was arranged for a
 * one-column tile and then handed two columns of a wide page.
 *
 * Unpriced generations are surfaced, never folded into the total as zero: the
 * headline is honestly a floor when the provider gave us no usage data, and a
 * spend figure that quietly understates itself is worse than no figure.
 */
export function AiSpendCard({ readings }: { readings: AiSpendReading[] }) {
  const [periodId, setPeriodId] = useState<AiSpendPeriodId>(
    readings[0]?.period.id ?? DEFAULT_AI_SPEND_PERIOD.id,
  );

  const reading = readings.find((candidate) => candidate.period.id === periodId) ?? readings[0];
  if (!reading) return null;

  const { period, summary } = reading;
  const change = aiSpendChange(summary);
  const rows = aiSpendActivityRows(summary);
  const hasPriced = summary.costUsd > 0;
  const rising = change !== null && change > 0;

  return (
    <section
      aria-labelledby="ai-spend-heading"
      className="flex h-full flex-col rounded-panel border border-rule bg-white"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-5 sm:px-6">
        <div>
          <h2
            id="ai-spend-heading"
            className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
          >
            AI spend
          </h2>
          <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
            Every draft, regeneration and booklet the platform writes is billed
            by the provider. Choose how far back to look — each stretch is
            compared with the same length of time before it.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <label className="flex items-center gap-2">
            <span className="sr-only">How far back these figures look</span>
            <select
              value={period.id}
              onChange={(event) => setPeriodId(event.target.value as AiSpendPeriodId)}
              className="cursor-pointer rounded-inset border border-rule bg-white px-3 py-1.5 font-body text-[13px] font-semibold text-ink outline-none focus:border-lead focus:ring-1 focus:ring-lead"
            >
              {readings.map((candidate) => (
                <option key={candidate.period.id} value={candidate.period.id}>
                  {candidate.period.label}
                </option>
              ))}
            </select>
          </label>
          <Link
            href="/admin/ai-generations"
            className="font-body text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
          >
            Every generation and its cost →
          </Link>
        </div>
      </div>

      <div className="px-5 pt-4 sm:px-6">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-body text-[clamp(1.75rem,4vw,2.5rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
            {formatUsd(summary.costUsd)}
          </span>
          <span className="font-body text-sm leading-[1.55] text-dim">
            {summary.generations === 0
              ? "no generations in this stretch"
              : `across ${summary.generations.toLocaleString()} ${
                  summary.generations === 1 ? "generation" : "generations"
                }`}
          </span>
        </p>
        <p className="mt-1.5 font-body text-[13px] leading-[1.55]">
          {change === null ? (
            <span className="text-dim">
              Nothing was spent in {period.comparison}, so there is nothing to
              compare this with yet.
            </span>
          ) : (
            <span className={rising ? "font-semibold text-stop" : "font-semibold text-go"}>
              {rising ? "Up" : "Down"} {Math.abs(change).toFixed(0)}% on{" "}
              {period.comparison}
            </span>
          )}
        </p>

        <h3 className="mt-5 font-body text-[14px] font-semibold text-ink">
          What it went on
        </h3>
        {hasPriced ? (
          <>
            <div className="mt-2.5">
              <AiSpendActivityGauge summary={summary} />
            </div>
            {/* The legend carries the figures, not just the colours: five
                unlabelled dots was the old version's only account of the
                split. A category that ran without ever being billed keeps its
                row and says so. */}
            <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.activity}
                  className="flex items-center gap-1.5 font-body text-[12.5px] leading-none"
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: row.colour }}
                  />
                  <span className="text-dim">{row.label}</span>
                  {row.costUsd > 0 ? (
                    <>
                      <span className="font-semibold tabular-nums text-ink">
                        {formatUsd(row.costUsd)}
                      </span>
                      <span className="tabular-nums text-dim">
                        {formatShare(row.share)}
                      </span>
                    </>
                  ) : (
                    <span className="text-dim">no cost recorded</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 font-body text-[13px] leading-[1.55] text-dim">
            {summary.generations === 0
              ? "No generation ran in this stretch, so there is nothing to split."
              : "Nothing in this stretch has been priced yet, so there is no split to show."}
          </p>
        )}
      </div>

      {hasPriced && (
        <div className="mt-5 border-t border-rule-soft px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="font-body text-[14px] font-semibold text-ink">
              Spend by day
            </h3>
            <p className="font-body text-[12.5px] text-dim">
              {aiSpendRangeLabel(summary)}
            </p>
          </div>
          <div className="mt-2">
            <AiSpendDailyChart summary={summary} />
            <p className="mt-1 font-body text-[12.5px] leading-[1.55] text-dim">
              Each stick is a date, split by kind of work — the colours are the
              ones in What it went on above.
            </p>
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pt-4 pb-5 sm:px-6">
        {summary.generations > 0 && (
          <p className="font-body text-[13.5px] leading-[1.55] text-dim">
            {summary.totalTokens.toLocaleString()} tokens
            {summary.models.length > 0 ? ` · ${summary.models.join(", ")}` : ""}
          </p>
        )}

        {summary.unpriced > 0 && (
          <p className="font-body text-[12.5px] leading-[1.55] text-dim">
            {summary.unpriced.toLocaleString()} generation
            {summary.unpriced === 1 ? "" : "s"} carried no cost — the provider
            reported no usage, or no pricing row covered the model. The figure
            above is a floor.
          </p>
        )}
      </div>
    </section>
  );
}

export default AiSpendCard;
