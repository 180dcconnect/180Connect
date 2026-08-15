import Link from "next/link";

import { FunnelChart } from "@/components/ui/funnel-chart";

import { SortMenu } from "./sort-menu";
import {
  BREAKDOWN_FIELDS,
  FUNNEL_STAGE_KEYS,
  SORT_DIRECTIONS,
  type BreakdownField,
  type BreakdownRow,
  type FunnelStage,
  type FunnelStageKey,
  type SortDirection,
} from "./client-insights";

/**
 * The pipeline report — one white card above the client list, in three parts:
 * the four stage totals, the stream that connects them, and the top-three
 * breakdown under it.
 *
 * White on the bone ground, in the app's own tokens, because the logged-in app
 * is a light tool and one dark slab at the top of a light page reads as a widget
 * borrowed from somewhere else. Treating the report as one object rather than as
 * several panels is what stops the top of this page from becoming another grid
 * of boxes — the list below it is already that.
 *
 * Picking a stage re-ranks the table under it. Nothing here filters the list:
 * this card is for reading, the list is for working, and mixing the two means a
 * click on a number quietly hides rows.
 */

/**
 * The 180DC green, passed to the chart as a literal rather than through
 * `var(--brand)`: the chart builds its layers by compositing this one colour at
 * three opacities, and a CSS variable resolved inside an SVG `fill` can't be
 * varied that way.
 */
const BRAND_GREEN = "#72b744";

const SHORT_LABEL: Record<FunnelStageKey, string> = {
  all: "In database",
  contacted: "Contacted",
  responded: "Responded",
  converted: "Converted",
};

/** How the breakdown sentence names the selected stage. */
const SUBJECT: Record<FunnelStageKey, string> = {
  all: "Clients",
  contacted: "Contacted clients",
  responded: "Clients who responded",
  converted: "Converted clients",
};

const percent = (share: number) => `${Math.round(share * 100)}%`;

export function PipelineReport({
  stages,
  selected,
  stageHref,
  caption,
  field,
  direction,
  rows,
  rowHref,
}: {
  stages: FunnelStage[];
  selected: FunnelStageKey;
  stageHref: (stage: FunnelStageKey) => string;
  /** What the card is counting — all clients, or the filtered subset. */
  caption: string;
  field: BreakdownField;
  direction: SortDirection;
  rows: BreakdownRow[];
  rowHref: (filter: NonNullable<BreakdownRow["filter"]>) => string;
}) {
  const chartData = stages.map((stage) => ({
    label: SHORT_LABEL[stage.key],
    value: stage.count,
  }));

  return (
    <section className="overflow-hidden rounded-3xl bg-white text-foreground ring-1 ring-black/[0.06] shadow-[0_20px_60px_-45px_rgba(12,16,20,0.55)]">
      <div className="px-6 pt-6 sm:px-8 sm:pt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[19px] font-black tracking-[-0.02em]">Pipeline report</h2>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
            {caption}
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-4">
          {stages.map((stage, index) => {
            const active = stage.key === selected;
            const previous = index === 0 ? null : stages[index - 1];
            return (
              <Link
                key={stage.key}
                href={stageHref(stage.key)}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
              >
                <p
                  className={`flex items-center gap-2 text-[13px] font-bold transition-colors ${
                    active ? "text-brand-hover" : "text-foreground/55 group-hover:text-foreground/80"
                  }`}
                >
                  {SHORT_LABEL[stage.key]}
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full transition-opacity ${
                      active ? "bg-brand opacity-100" : "bg-foreground opacity-0 group-hover:opacity-30"
                    }`}
                  />
                </p>

                <p className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-[clamp(1.5rem,3.2vw,2.1rem)] font-bold tracking-[-0.04em] tabular-nums">
                    {stage.count.toLocaleString()}
                  </span>
                  {stage.shareOfPrevious !== null && (
                    <span className="text-[12px] font-bold text-brand-hover">
                      {percent(stage.shareOfPrevious)}
                    </span>
                  )}
                </p>

                <p className="mt-1 text-[12px] leading-[1.5] text-foreground/40">
                  {previous
                    ? `of ${previous.count.toLocaleString()} ${SHORT_LABEL[previous.key].toLowerCase()}`
                    : stage.caption}
                </p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* The stream, as segmented layers rather than one continuous ribbon: each
          stage is its own panel, tapering into the next, with alternating bands
          behind so the four steps are countable at a glance. Layers, hover
          swell, and the entrance stagger all come from the chart; everything
          this card knows about the data goes in as `chartData`.

          Values and stage names are off. The four totals directly above already
          say both, and printing them twice, six inches apart, makes the reader
          check whether the two agree. The percentage pill is the one thing the
          picture can say that the row above cannot: share of the whole book. */}
      <div className="mt-7">
        <FunnelChart
          data={chartData}
          color={BRAND_GREEN}
          layers={3}
          gap={4}
          edges="curved"
          hold={0.36}
          showValues={false}
          showLabels={false}
          className="h-[190px] sm:h-[240px]"
          style={{ aspectRatio: "auto" }}
          grid={{
            // No bands. Alternating tints are for reading a value off a
            // position, and nothing here is read that way — the marker lines
            // already say where each stage begins, and a green wash behind a
            // green shape only muddies where the shape's own edge is.
            bands: false,
            lines: true,
            lineColor: "#0c1014",
            lineOpacity: 0.07,
          }}
        />
      </div>

      <div className="px-6 pt-2 pb-6 sm:px-8 sm:pb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <p className="font-body font-semibold tracking-[-0.04em] text-[26px] leading-[1.6] text-black">
            {SUBJECT[selected]} sorted by{" "}
            <SortMenu
              param="sort"
              value={field}
              ariaLabel="Group the breakdown by"
              options={BREAKDOWN_FIELDS.map((entry) => ({ value: entry.key, label: entry.label }))}
            />
            ,{" "}
            <SortMenu
              param="dir"
              value={direction}
              ariaLabel="Sort direction"
              options={SORT_DIRECTIONS.map((entry) => ({ value: entry, label: entry }))}
            />
          </p>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/30">
            Top {rows.length || 3}
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="mt-5 text-sm text-foreground/45">Nothing to group here yet.</p>
        ) : (
          <div className="mt-4">
            <div className={`${TABLE_GRID} border-b border-black/[0.07] pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground/30`}>
              <span />
              {FUNNEL_STAGE_KEYS.map((key) => (
                <span
                  key={key}
                  className={`text-right ${key === selected ? "text-brand-hover/70" : "hidden sm:block"}`}
                >
                  {SHORT_LABEL[key]}
                </span>
              ))}
            </div>

            <ol>
              {rows.map((row) => {
                const cells = FUNNEL_STAGE_KEYS.map((key) => (
                  <span
                    key={key}
                    className={`text-right text-[14px] tabular-nums ${
                      key === selected
                        ? "font-bold text-brand-hover"
                        : "hidden text-foreground/55 sm:block"
                    }`}
                  >
                    {row.counts[key].toLocaleString()}
                  </span>
                ));

                const body = (
                  <>
                    <span className="min-w-0 truncate text-[15px] text-foreground/85">
                      {row.label}
                    </span>
                    {cells}
                  </>
                );

                return (
                  <li key={row.key} className="border-b border-black/[0.07] last:border-b-0">
                    {row.filter ? (
                      <Link
                        href={rowHref(row.filter)}
                        className={`${TABLE_GRID} items-baseline py-3 transition-colors hover:bg-black/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand`}
                      >
                        {body}
                      </Link>
                    ) : (
                      // Nothing selects "no city recorded" in the list, so this
                      // row counts but doesn't pretend to be a link.
                      <div className={`${TABLE_GRID} items-baseline py-3`}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Label, then one column per stage. Below `sm` only the ranked stage's column
 * survives (the rest are `hidden`), so the row stays a row instead of four
 * numbers crushed into a phone's width.
 */
const TABLE_GRID =
  "grid grid-cols-[minmax(0,1fr)_5rem] gap-4 px-2 sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(3.5rem,6rem))]";
