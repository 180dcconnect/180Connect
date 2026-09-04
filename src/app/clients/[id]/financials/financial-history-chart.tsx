"use client";

import { useMemo, useState } from "react";

import { formatCompactGbp, formatGbp } from "@/lib/income-band";
import type {
  FinancialSeries,
  FinancialYear,
  GrantInput,
} from "@/lib/financials/financial-series";
import ProgressMetricCard, { type PeriodOption } from "@/components/ui/progress-metric-card";
import {
  DEFICIT,
  EXPENDITURE,
  INCOME,
  Legend,
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

export function FinancialHistoryChart({ series }: { series: FinancialSeries }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { years, peak, peakNet } = series;

  if (years.length === 0) return null;

  const active = hovered !== null ? years[hovered] : null;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[14px] font-semibold text-ink">Income and spending</h3>
        <Legend
          items={[
            { colour: INCOME, label: "Income" },
            { colour: EXPENDITURE, label: "Spending" },
          ]}
        />
      </div>

      <div className="relative mt-3">
        {/* Peak rule and zero baseline are the whole grid. A gridline every
            £50k on a five-column chart is furniture, not information. */}
        <div className="absolute inset-x-0 top-0 flex items-center gap-2">
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">
            {formatCompactGbp(peak)}
          </span>
          <span aria-hidden="true" className="h-px flex-1 bg-rule-soft" />
        </div>

        <div className="flex h-[132px] items-end gap-2 pt-4">
          {years.map((year, index) => (
            <div
              key={year.periodEnd}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              aria-label={`${year.label}: income ${formatGbp(year.income)}, spending ${formatGbp(year.expenditure)}`}
              className={`flex h-full flex-1 items-end justify-center gap-[2px] rounded-t-[4px] px-1 outline-none transition-colors ${
                hovered === index ? "bg-paper" : ""
              } focus-visible:ring-2 focus-visible:ring-lead-mid`}
            >
              <span
                aria-hidden="true"
                className="w-full max-w-[28px] rounded-t-[4px]"
                style={{
                  height: `${percent(year.income, peak)}%`,
                  backgroundColor: INCOME,
                  minHeight: year.income !== null ? 2 : 0,
                }}
              />
              <span
                aria-hidden="true"
                className="w-full max-w-[28px] rounded-t-[4px]"
                style={{
                  height: `${percent(year.expenditure, peak)}%`,
                  backgroundColor: EXPENDITURE,
                  minHeight: year.expenditure !== null ? 2 : 0,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Surplus and deficit: its own panel under the same columns, because it
          is a different scale. Direction from the zero line carries the sign
          before any colour does, and the number is signed as well. */}
      <div className="mt-1 border-t border-rule pt-1">
        <div className="flex h-[46px] items-center gap-2">
          {years.map((year) => {
            const net = year.net;
            const magnitude = percent(net === null ? null : Math.abs(net), peakNet);
            return (
              <div
                key={year.periodEnd}
                className="flex h-full flex-1 flex-col items-center justify-start"
              >
                {net === null ? null : (
                  <span
                    aria-hidden="true"
                    className="w-full max-w-[28px] rounded-b-[4px]"
                    style={{
                      height: `${Math.max(magnitude * 0.34, 2)}%`,
                      backgroundColor: net >= 0 ? SURPLUS : DEFICIT,
                      alignSelf: "center",
                    }}
                  />
                )}
                <span
                  className={`mt-1 font-mono text-[11px] tabular-nums ${
                    net === null ? "text-faint" : net >= 0 ? "text-go" : "text-stop"
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

      <div className="mt-1 flex gap-2">
        {years.map((year, index) => (
          <span
            key={year.periodEnd}
            className={`flex-1 text-center text-[11.5px] ${
              hovered === index ? "font-semibold text-ink" : "text-dim"
            }`}
          >
            {year.label}
          </span>
        ))}
      </div>

      {/* The tooltip is a fixed row rather than a floating card: with five
          columns in a narrow card, a card that follows the cursor spends its
          life covering the columns either side of the one being read. */}
      <p className="mt-2 min-h-[18px] text-[12px] text-dim" aria-live="polite">
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

/**
 * Year-on-year grant funding won over time, rendered with the dashboard's ProgressMetricCard.
 */
export function YearOnYearGrantsChart({
  series,
  grants,
}: {
  series: FinancialSeries;
  grants?: readonly GrantInput[];
}) {
  const points = useMemo(() => {
    // 1. Group raw grants by award year (calendar year):
    const byYear = new Map<string, number>();
    if (grants && grants.length > 0) {
      for (const grant of grants) {
        if (!grant.award_date || grant.amount_awarded === null || grant.amount_awarded <= 0) continue;
        const currency = (grant.currency ?? "GBP").toUpperCase();
        if (currency !== "GBP") continue;
        const year = grant.award_date.slice(0, 4);
        if (!/^\d{4}$/.test(year)) continue;
        byYear.set(year, (byYear.get(year) ?? 0) + grant.amount_awarded);
      }
    }

    // 2. If series has filed financial years with grants and covers the data:
    const filedYearsWithGrants = series.years.filter((y) => y.grantTotal > 0);
    if (
      series.years.length >= 2 &&
      filedYearsWithGrants.length > 0 &&
      filedYearsWithGrants.length >= byYear.size
    ) {
      return series.years.map((y) => ({
        date: y.label,
        value: y.grantTotal,
      }));
    }

    // 3. Otherwise, use all grants grouped by calendar year (filling gaps):
    if (byYear.size >= 1) {
      const yearNums = [...byYear.keys()].map(Number).sort((a, b) => a - b);
      const min = yearNums[0];
      const max = yearNums[yearNums.length - 1];
      if (max - min >= 1 && max - min <= 20) {
        const fullRange: { date: string; value: number }[] = [];
        for (let y = min; y <= max; y++) {
          fullRange.push({
            date: String(y),
            value: byYear.get(String(y)) ?? 0,
          });
        }
        return fullRange;
      }
      if (byYear.size >= 2) {
        return [...byYear.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([year, total]) => ({
            date: year,
            value: total,
          }));
      }
    }

    // 4. Fall back to series.years if it has at least 2 points:
    if (series.years.length >= 2 && series.hasGrants) {
      return series.years.map((y) => ({
        date: y.label,
        value: y.grantTotal,
      }));
    }

    return [];
  }, [series, grants]);

  if (points.length < 2) return null;

  const totalAmount = points.reduce((sum, p) => sum + p.value, 0);
  const periodOptions: PeriodOption[] = [
    ...(points.length > 5 ? [{ label: "Past 5 years", points: 5 }] : []),
    ...(points.length > 10 ? [{ label: "Past 10 years", points: 10 }] : []),
    { label: "All years" },
  ];

  return (
    <div className="mt-4 mb-2">
      <ProgressMetricCard
        size="md"
        title="Year-on-year grant funding"
        total={formatCompactGbp(totalAmount).toUpperCase()}
        unit="in grants"
        deltaLabel="vs prior year"
        accent="brand"
        data={points}
        defaultView="curve"
        fullWidth
        period={periodOptions[0].label}
        periodOptions={periodOptions}
        valueFormatter={(val) => formatGbp(val)}
        dateFormatter={(d) => d}
        showStats
        showDelta
        className="rounded-2xl border-rule-soft shadow-sm"
      />
    </div>
  );
}

export { YearOnYearGrantsChart as GrantShareChart };

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
