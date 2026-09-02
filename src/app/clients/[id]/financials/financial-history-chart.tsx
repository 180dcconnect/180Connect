"use client";

import { useState } from "react";

import { formatCompactGbp, formatGbp } from "@/lib/income-band";
import type { FinancialSeries, FinancialYear } from "@/lib/financials/financial-series";

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
 * The palette is the app's own tag colours (`src/lib/tags/tag-colours.ts`)
 * rather than new hexes: blue #175cd3 income, amber #b54708 expenditure, green
 * #067647 grant income, red #b42318 deficit. All validated against a white
 * surface for lightness, chroma, CVD separation and contrast.
 */

const INCOME = "#175cd3";
const EXPENDITURE = "#b54708";
const SURPLUS = "#067647";
const DEFICIT = "#b42318";

function percent(value: number | null, of: number): number {
  if (value === null || of <= 0) return 0;
  return Math.max(0, Math.min(100, (value / of) * 100));
}

function Legend({ items }: { items: { colour: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[12px] text-dim">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: item.colour }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** The numbers behind a chart, for anyone the chart does not serve. */
function SeriesTable({
  years,
  columns,
}: {
  years: FinancialYear[];
  columns: { header: string; cell: (year: FinancialYear) => string }[];
}) {
  return (
    <details className="group mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        View as a table
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[24rem] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-rule-soft text-left text-faint">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Year
              </th>
              {columns.map((column) => (
                <th key={column.header} scope="col" className="py-1.5 pr-3 font-medium">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year.periodEnd} className="border-b border-rule-soft last:border-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink">
                  {year.label}
                </th>
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className="py-1.5 pr-3 font-mono tabular-nums text-dim"
                  >
                    {column.cell(year)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

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
 * Grant funding against income, one stacked column per filed year.
 *
 * The framing in the heading is doing real work. 360Giving publishes the date
 * an award was *made*, not the years it pays out over, so a three-year grant
 * lands wholly in the year it was announced. "New grant funding won" is what
 * this actually measures; "what share of their income is grants" is the claim
 * it would be wrong to make.
 */
export function GrantShareChart({ series }: { series: FinancialSeries }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const years = series.years;

  if (!series.hasGrants || !series.hasIncome) return null;

  const scale = Math.max(
    series.peak,
    ...years.map((year) => year.grantTotal),
  );
  const active = hovered !== null ? years[hovered] : null;

  return (
    <div className="mt-6 border-t border-rule-soft pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[14px] font-semibold text-ink">
          New grant funding against income
        </h3>
        <Legend
          items={[
            { colour: SURPLUS, label: "Grants awarded" },
            { colour: INCOME, label: "Rest of income" },
          ]}
        />
      </div>

      <div className="mt-3 flex h-[110px] items-end gap-2">
        {years.map((year, index) => {
          const grantHeight = percent(year.grantTotal, scale);
          const restHeight = percent(
            year.income === null ? null : Math.max(0, year.income - year.grantTotal),
            scale,
          );
          return (
            <div
              key={year.periodEnd}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              aria-label={`${year.label}: ${formatGbp(year.grantTotal)} awarded against income of ${formatGbp(year.income)}`}
              className={`flex h-full flex-1 flex-col items-center justify-end outline-none ${
                hovered === index ? "bg-paper" : ""
              } rounded-t-[4px] px-1 focus-visible:ring-2 focus-visible:ring-lead-mid`}
            >
              {year.grantShare !== null && year.grantTotal > 0 && (
                <span className="mb-1 font-mono text-[11px] tabular-nums text-ink">
                  {Math.round(year.grantShare * 100)}%
                </span>
              )}
              <span
                aria-hidden="true"
                className="w-full max-w-[28px] rounded-t-[4px]"
                style={{ height: `${restHeight}%`, backgroundColor: INCOME }}
              />
              {/* 2px of surface between stacked segments, so the boundary is a
                  gap rather than two colours meeting. */}
              <span aria-hidden="true" className="h-[2px] w-full" />
              <span
                aria-hidden="true"
                className="w-full max-w-[28px] rounded-b-[4px]"
                style={{
                  height: `${grantHeight}%`,
                  backgroundColor: SURPLUS,
                  minHeight: year.grantTotal > 0 ? 2 : 0,
                }}
              />
            </div>
          );
        })}
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

      <p className="mt-2 min-h-[18px] text-[12px] text-dim" aria-live="polite">
        {active ? (
          <>
            <span className="font-semibold text-ink">{active.label}</span> —{" "}
            {formatGbp(active.grantTotal)} awarded
            {active.grantShare !== null &&
              `, ${Math.round(active.grantShare * 100)}% of that year's income`}
            {active.grantsExcluded > 0 &&
              ` · ${active.grantsExcluded} award${active.grantsExcluded === 1 ? "" : "s"} in another currency, not counted`}
          </>
        ) : (
          "Awards are placed by the date they were made, not the years they pay out over."
        )}
      </p>

      <SeriesTable
        years={years}
        columns={[
          { header: "Grants awarded", cell: (year) => formatGbp(year.grantTotal) },
          { header: "Income", cell: (year) => formatGbp(year.income) },
          {
            header: "Share",
            cell: (year) =>
              year.grantShare === null
                ? "Income not filed"
                : `${Math.round(year.grantShare * 100)}%`,
          },
        ]}
      />
    </div>
  );
}

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
