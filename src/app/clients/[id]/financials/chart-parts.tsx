import type { ReactNode } from "react";

import type { FinancialYear } from "@/lib/financials/financial-series";

/**
 * The pieces every figure on the Financials tab draws with.
 *
 * These all began life as private helpers inside `financial-history-chart.tsx`
 * and `fund-flow-sankey.tsx`. Two of the palette entries had already been
 * copied by hand into a third file, which is the point at which a private
 * helper has stopped being private and has become a convention kept in two
 * places. Sections 4 and 5 need all of them, so they live here instead.
 *
 * Not marked `"use client"` on purpose. Nothing in this file holds state, so a
 * server component can render it directly — which is what the tab's newer
 * sections do — while the two client charts keep importing it exactly as they
 * imported their own locals.
 */

/**
 * The app's tag colours (`src/lib/tags/tag-colours.ts`), not new hexes: blue
 * income, amber expenditure, green grant money and surplus, red deficit. All
 * four are validated against a white surface for lightness, chroma, CVD
 * separation and contrast.
 *
 * Deliberately hexes rather than theme tokens. A chart series is a *quantity*
 * being identified, not a piece of interface furniture taking a semantic
 * colour, and promoting these to `--go` / `--stop` would put a chart series and
 * a status pill on the same swatch — which is how a chart ends up saying
 * "expenditure is a warning".
 */
export const INCOME = "#175cd3";
export const EXPENDITURE = "#b54708";
export const SURPLUS = "#067647";
export const DEFICIT = "#b42318";

export { calculateNiceYAxis } from "@/lib/financials/financial-series";

/** A bar width, as a percentage of the largest value in its group. Null is not
 *  zero anywhere else on this tab, but a bar has to be drawn at some width, and
 *  the caller is expected to have suppressed the row before it gets here. */
export function percent(value: number | null, of: number): number {
  if (value === null || of <= 0) return 0;
  return Math.max(0, Math.min(100, (value / of) * 100));
}

/**
 * A share as the reader would say it.
 *
 * A filed line worth a fifth of a percent is still a filed line, and rounding
 * it to "0%" beside a visible band reads as a bug in the chart rather than as a
 * small number.
 */
export function share(fraction: number): string {
  const asPercent = fraction * 100;
  if (asPercent > 0 && asPercent < 1) return "<1%";
  return `${Math.round(asPercent)}%`;
}

export function Legend({ items }: { items: { colour: string; label: string }[] }) {
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

/**
 * The record's stat block: a quiet label, the figure in mono at a size you can
 * read across the room, and a caption saying which filing it came from.
 *
 * Lifted out of `financials-hero-card.tsx`, where it was written three times
 * inline. `value` takes a node rather than a string because the signed variants
 * carry an arrow and a colour with them.
 */
export function StatBlock({
  label,
  value,
  caption,
  className = "",
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[12.5px] text-dim">{label}</p>
      <div className="mt-1">{value}</div>
      {caption && <p className="mt-0.5 text-[11.5px] text-faint">{caption}</p>}
    </div>
  );
}

/** The figure inside a `StatBlock`, at the record's headline weight. */
export function StatFigure({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[22px] font-bold tracking-tight tabular-nums text-ink">
      {children}
    </p>
  );
}

/** The same slot when the register published nothing. Smaller and faint, so an
 *  absent figure never reads as a filed one. */
export function StatMissing({ children = "Not reported" }: { children?: ReactNode }) {
  return <p className="font-mono text-[18px] text-faint">{children}</p>;
}

/**
 * The "View as a table" disclosure that sits under every figure on this tab.
 *
 * The numbers behind a chart, for anyone the chart does not serve. A chart is a
 * claim and the table is the receipt, so no figure here ships without one.
 * Columns are supplied by the caller because each figure reads a different set
 * of fields off the year.
 */
export function SeriesTable({
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
