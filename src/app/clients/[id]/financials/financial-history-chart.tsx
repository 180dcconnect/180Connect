"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

import { formatCompactGbp, formatGbp } from "@/lib/income-band";
import type {
  FinancialSeries,
  FinancialYear,
} from "@/lib/financials/financial-series";
import {
  calculateNiceYAxis,
  DEFICIT,
  EXPENDITURE,
  INCOME,
  percent,
  SeriesTable,
  SURPLUS,
} from "./chart-parts";

/**
 * The filed-accounts charts: what came in against what went out, the surplus or
 * deficit that leaves, and how much of the income was new grant funding.
 *
 * Three deliberate choices, in the order they matter:
 *
 * - **One axis, never two.** Income and expenditure are both pounds, so they
 *   share a scale and can sit in one plot. The surplus is a *derived* quantity
 *   on a different scale, so it gets its own panel under the same year columns
 *   rather than a second y-axis — the chart mistake this file most wanted to
 *   make.
 * - **Colour is not the only encoding.** Every series is direct-labelled or
 *   named in a legend, the surplus panel encodes sign by direction from the
 *   zero line *and* by a signed number, and there is a table under each chart.
 *   The green/amber pairing sits at ΔE 7.3 for protanopia, which is legal only
 *   with that secondary encoding; the blue/amber and blue/green pairings each
 *   clear ΔE 20 on their own.
 * - **Marks are thin and the grid is recessive.** Columns are capped at 28px
 *   with a 2px gap; the only rules drawn are the zero baseline and the peak.
 *
 * The palette, the share formatter, the legend and the table disclosure all
 * live in `./chart-parts` — sections 4 and 5 draw with the same set, and two of
 * these colours had already been copied by hand into a third file before it was
 * shared.
 */

const MAX_BARREL_STICKS = 36;
const MAX_NET_STICKS = 10;

export function FinancialHistoryChart({ series }: { series: FinancialSeries }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [hasEnteredView, setHasEnteredView] = useState(false);
  const { years, peak, peakNet } = series;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setHasEnteredView(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setHasEnteredView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(node);

    const timer = setTimeout(() => setHasEnteredView(true), 1200);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  const yAxis = useMemo(() => calculateNiceYAxis(peak), [peak]);

  if (years.length === 0) return null;

  const active = hovered !== null ? years[hovered] : null;
  const isAnyHovered = hovered !== null;
  const safeYMax = yAxis.max > 0 ? yAxis.max : 1;
  const safePeakNet = peakNet > 0 ? peakNet : 1;

  return (
    <div ref={containerRef} className="mt-4 select-none">
      <div className="flex items-center justify-end">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Chart legend">
          <li className="flex items-center gap-2 text-[12px] text-dim">
            <span aria-hidden="true" className="flex flex-col gap-[1.5px]">
              <span className="h-[2px] w-3 rounded-full" style={{ backgroundColor: INCOME }} />
              <span className="h-[2px] w-3 rounded-full" style={{ backgroundColor: INCOME }} />
              <span className="h-[2px] w-3 rounded-full" style={{ backgroundColor: INCOME }} />
            </span>
            Income
          </li>
          <li className="flex items-center gap-2 text-[12px] text-dim">
            <span aria-hidden="true" className="flex flex-col gap-[1.5px]">
              <span className="h-[2px] w-3 rounded-full" style={{ backgroundColor: EXPENDITURE }} />
              <span className="h-[2px] w-3 rounded-full" style={{ backgroundColor: EXPENDITURE }} />
              <span className="h-[2px] w-3 rounded-full" style={{ backgroundColor: EXPENDITURE }} />
            </span>
            Spending
          </li>
        </ul>
      </div>

      {/* Main plot area with Y-axis graduation scale on the left */}
      <div className="relative mt-4 pt-2.5">
        <div className="flex items-end">
          {/* Left Y-axis graduation scale */}
          <div className="relative h-[214px] w-14 shrink-0 sm:w-16" aria-hidden="true">
            {yAxis.ticks.map((tick) => {
              const topPercent = (1 - tick / safeYMax) * 100;
              return (
                <div
                  key={tick}
                  className="absolute right-2.5 -translate-y-1/2 flex items-center justify-end"
                  style={{ top: `${topPercent}%` }}
                >
                  <span className="font-mono text-[10.5px] tabular-nums text-faint">
                    {formatCompactGbp(tick)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Right plot area: gridlines + year columns */}
          <div className="relative h-[214px] flex-1 min-w-0">
            {/* Horizontal gridlines for each graduation tick */}
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {yAxis.ticks.map((tick) => {
                const topPercent = (1 - tick / safeYMax) * 100;
                const isZero = tick === 0;
                return (
                  <div
                    key={`grid-${tick}`}
                    className={`absolute inset-x-0 h-px ${
                      isZero ? "bg-rule" : "bg-rule-soft/60"
                    }`}
                    style={{ top: `${topPercent}%` }}
                  />
                );
              })}
            </div>

            {/* Year columns */}
            <div className="relative flex h-full items-end gap-2">
              {years.map((year, index) => {
                const isHovered = hovered === index;
                const hasIncome = year.income !== null && year.income > 0;
                const hasExpenditure = year.expenditure !== null && year.expenditure > 0;

                const incomeStickCount = hasIncome
                  ? Math.max(1, Math.min(MAX_BARREL_STICKS, Math.round((year.income! / safeYMax) * MAX_BARREL_STICKS)))
                  : 0;

                const expStickCount = hasExpenditure
                  ? Math.max(1, Math.min(MAX_BARREL_STICKS, Math.round((year.expenditure! / safeYMax) * MAX_BARREL_STICKS)))
                  : 0;

                return (
                  <div
                    key={year.periodEnd}
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(index)}
                    onBlur={() => setHovered(null)}
                    tabIndex={0}
                    aria-label={`${year.label}: income ${formatGbp(year.income)}, spending ${formatGbp(year.expenditure)}${
                      year.net !== null
                        ? `, ${year.net >= 0 ? "surplus" : "deficit"} ${formatGbp(Math.abs(year.net))}`
                        : ""
                    }`}
                    className={`flex h-full flex-1 cursor-pointer flex-col items-center justify-end rounded-t-panel px-1 outline-none transition-all duration-150 ${
                      isHovered ? "bg-paper/80 shadow-xs" : ""
                    } ${isAnyHovered && !isHovered ? "opacity-45" : "opacity-100"} focus-visible:ring-2 focus-visible:ring-lead-mid`}
                  >
                    {/* Two barrels side by side: Income (left) and Spending (right) */}
                    <div className="flex items-end gap-1.5 pb-0.5 sm:gap-2">
                      {/* Income barrel: horizontal sticks stacked bottom-to-top */}
                      <div className="flex h-[214px] flex-col-reverse justify-start gap-[2px]" aria-hidden="true">
                        {hasIncome ? (
                          Array.from({ length: incomeStickCount }, (_, stickIdx) => (
                            <motion.div
                              key={`inc-stick-${stickIdx}`}
                              initial={{ opacity: 0, scaleX: 0.6, originX: 0.5 }}
                              animate={{
                                opacity: hasEnteredView ? (isHovered ? 1 : 0.9) : 0,
                                scaleX: hasEnteredView ? (isHovered ? 1.08 : 1) : 0.6,
                              }}
                              transition={{
                                duration: 0.2,
                                delay: index * 0.05 + stickIdx * 0.008,
                                ease: [0.16, 1, 0.3, 1],
                              }}
                              className="h-[4px] w-[18px] rounded-[1.5px] transition-all duration-150 sm:w-[22px]"
                              style={{ backgroundColor: INCOME }}
                            />
                          ))
                        ) : year.income !== null ? (
                          <span className="h-[2px] w-[18px] rounded-full bg-rule-soft sm:w-[22px]" />
                        ) : null}
                      </div>

                      {/* Spending barrel: horizontal sticks stacked bottom-to-top */}
                      <div className="flex h-[214px] flex-col-reverse justify-start gap-[2px]" aria-hidden="true">
                        {hasExpenditure ? (
                          Array.from({ length: expStickCount }, (_, stickIdx) => (
                            <motion.div
                              key={`exp-stick-${stickIdx}`}
                              initial={{ opacity: 0, scaleX: 0.6, originX: 0.5 }}
                              animate={{
                                opacity: hasEnteredView ? (isHovered ? 1 : 0.9) : 0,
                                scaleX: hasEnteredView ? (isHovered ? 1.08 : 1) : 0.6,
                              }}
                              transition={{
                                duration: 0.2,
                                delay: index * 0.05 + 0.02 + stickIdx * 0.008,
                                ease: [0.16, 1, 0.3, 1],
                              }}
                              className="h-[4px] w-[18px] rounded-[1.5px] transition-all duration-150 sm:w-[22px]"
                              style={{ backgroundColor: EXPENDITURE }}
                            />
                          ))
                        ) : year.expenditure !== null ? (
                          <span className="h-[2px] w-[18px] rounded-full bg-rule-soft sm:w-[22px]" />
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Surplus and deficit: horizontal sticks stacked vertically downwards from the zero baseline */}
      <div className="flex items-start pt-1.5">
        <div className="flex w-14 shrink-0 items-start justify-end pr-2.5 pt-1 sm:w-16" aria-hidden="true">
          <span className="font-mono text-[10px] font-medium tracking-wider text-faint uppercase">
            Net
          </span>
        </div>
        <div className="flex min-h-[82px] flex-1 min-w-0 items-start gap-2">
          {years.map((year, index) => {
            const isHovered = hovered === index;
            const net = year.net;
            const hasNet = net !== null && Math.abs(net) > 0;
            const netStickCount = hasNet
              ? Math.max(1, Math.min(MAX_NET_STICKS, Math.round((Math.abs(net) / safePeakNet) * MAX_NET_STICKS)))
              : 0;
            const netColor = net !== null && net >= 0 ? SURPLUS : DEFICIT;

            return (
              <div
                key={year.periodEnd}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                className={`flex flex-1 cursor-pointer flex-col items-center justify-start rounded-b-panel px-1 pb-1 transition-all duration-150 ${
                  isHovered ? "bg-paper/80 shadow-xs" : ""
                } ${isAnyHovered && !isHovered ? "opacity-45" : "opacity-100"}`}
              >
                {/* Net barrel: horizontal sticks stacked downwards from the zero line */}
                <div className="flex min-h-[58px] flex-col justify-start gap-[2px]" aria-hidden="true">
                  {hasNet ? (
                    Array.from({ length: netStickCount }, (_, stickIdx) => (
                      <motion.div
                        key={`net-stick-${stickIdx}`}
                        initial={{ opacity: 0, scaleX: 0.6, originX: 0.5 }}
                        animate={{
                          opacity: hasEnteredView ? (isHovered ? 1 : 0.9) : 0,
                          scaleX: hasEnteredView ? (isHovered ? 1.08 : 1) : 0.6,
                        }}
                        transition={{
                          duration: 0.18,
                          delay: index * 0.05 + 0.1 + stickIdx * 0.012,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        className="h-[4px] w-[20px] rounded-[1.5px] transition-all duration-150 sm:w-[24px]"
                        style={{ backgroundColor: netColor }}
                      />
                    ))
                  ) : (
                    <div className="h-[4px] w-[20px] sm:w-[24px]" />
                  )}
                </div>

                <span
                  className={`mt-1 font-mono text-[11px] tabular-nums transition-colors ${
                    net === null ? "text-faint" : net >= 0 ? "text-go font-medium" : "text-stop font-medium"
                  }`}
                >
                  {net === null
                    ? "—"
                    : `${net >= 0 ? "+" : "−"}${formatCompactGbp(Math.abs(net))}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1 flex items-center">
        <div className="w-14 shrink-0 sm:w-16" aria-hidden="true" />
        <div className="flex flex-1 min-w-0 gap-2">
          {years.map((year, index) => {
            const isHovered = hovered === index;
            return (
              <span
                key={year.periodEnd}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                className={`flex-1 cursor-pointer text-center text-[11.5px] transition-colors ${
                  isHovered ? "font-semibold text-ink" : "text-dim"
                } ${isAnyHovered && !isHovered ? "opacity-45" : "opacity-100"}`}
              >
                {year.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* The tooltip is a fixed row rather than a floating card */}
      <div className="mt-2 flex items-start">
        <div className="w-14 shrink-0 sm:w-16" aria-hidden="true" />
        <p className="min-h-[18px] flex-1 min-w-0 text-[12px] text-dim" aria-live="polite">
          {active ? (
            <>
              <span className="font-semibold text-ink">
                {active.label} · year ended{" "}
                {new Date(active.periodEnd).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              {" — "}
              income {formatGbp(active.income)}, spending {formatGbp(active.expenditure)}
              {active.net !== null &&
                `, ${active.net >= 0 ? "surplus" : "deficit"} ${formatGbp(Math.abs(active.net))}`}
            </>
          ) : (
            "Hover a year for its filed figures."
          )}
        </p>
      </div>

      <SeriesTable
        years={years}
        columns={[
          { header: "Income", cell: (year) => formatGbp(year.income) },
          { header: "Spending", cell: (year) => formatGbp(year.expenditure) },
          {
            header: "Surplus / deficit",
            cell: (year) =>
              year.net === null
                ? "Not reported"
                : `${year.net >= 0 ? "+" : "−"}${formatGbp(Math.abs(year.net))}`,
          },
        ]}
      />
    </div>
  );
}

export { YearOnYearGrantsChart } from "./year-on-year-grants-chart";
export { YearOnYearGrantsChart as GrantShareChart } from "./year-on-year-grants-chart";

/**
 * Where a year's income came from — the annual return's own split.
 *
 * A single hue, not a categorical palette. The question this answers is a
 * magnitude comparison across labelled categories ("which line is biggest, and
 * how much of the total is public money"), which is a bar chart with one
 * series: no legend, no eight-hue palette to keep colourblind-safe, and the
 * labels carry identity instead of colour. A five-slice stacked bar would have
 * needed five validated hues to say less.
 *
 * Government grants and contracts are pulled out above the bars rather than
 * left as two lines among six. It is the one figure here that changes how you
 * open a conversation, and it exists in no other source we hold.
 *
 * The parts are shown as filed and never reconciled: where the register
 * publishes a partial split they genuinely do not add up to the total, and an
 * invented "Other" bucket to close the gap would be this component asserting
 * arithmetic the register does not support. Hence the share is against the
 * *total*, and the note says so.
 */
export function IncomeMixPanel({ year }: { year: FinancialYear }) {
  if (year.mix.length === 0) return null;

  const peak = Math.max(...year.mix.map((source) => source.amount));
  const accounted = year.mix.reduce((sum, source) => sum + source.amount, 0);
  const partial =
    year.income !== null && year.income > 0 && accounted < year.income * 0.98;

  return (
    <div className="mt-6 border-t border-rule-soft pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[14px] font-semibold text-ink">
          Where the money came from
        </h3>
        <span className="text-[12px] text-dim">{year.label} annual return</span>
      </div>

      {year.governmentIncome !== null && (
        <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2 rounded-inset bg-lead-wash px-3 py-2 text-[12.5px] text-lead">
          <span className="font-semibold">
            {formatGbp(year.governmentIncome)} of public money
          </span>
          <span>
            {year.governmentShare !== null
              ? `— ${Math.round(year.governmentShare * 100)}% of that year's income, in government grants and contracts`
              : "— in government grants and contracts"}
          </span>
          {/* The count is what turns an amount into a relationship. £400k as
              one contract is a client with a public-sector partner; £400k
              across fifteen small grants is a client who spends its year
              fundraising. Same number, different conversation. */}
          {year.governmentAwards !== null && year.governmentAwards > 0 && (
            <span className="w-full text-[12px] text-lead/80">
              {year.governmentAwards === 1
                ? "A single award — one relationship to understand."
                : `Across ${year.governmentAwards} awards.`}
            </span>
          )}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {year.mix.map((source) => (
          <li key={source.label} className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-3">
            <span className="min-w-0 truncate text-[12.5px] text-dim">
              {source.label}
            </span>
            <span aria-hidden="true" className="h-[6px] w-full rounded-full bg-paper-sunk">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${percent(source.amount, peak)}%`,
                  backgroundColor: source.government ? SURPLUS : INCOME,
                  minWidth: 2,
                }}
              />
            </span>
            <span className="font-mono text-[12px] tabular-nums text-ink">
              {formatCompactGbp(source.amount)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11.5px] leading-[1.5] text-faint">
        {partial
          ? `The register published ${formatCompactGbp(accounted)} of this year's ${formatCompactGbp(year.income)} income as a breakdown — smaller charities file totals with only part of the split, so these lines are not expected to add up.`
          : "Lines as filed in the charity's annual return."}
      </p>
    </div>
  );
}
