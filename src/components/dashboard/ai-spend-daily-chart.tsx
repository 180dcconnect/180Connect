"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  AI_GENERATION_ACTIVITIES,
  AI_GENERATION_ACTIVITY_LABELS,
  aiSpendRangeLabel,
  aiSpendSpansYears,
  formatSpendDay,
  formatUsd,
  type AiGenerationActivity,
  type AiSpendBucket,
  type AiSpendSummary,
} from "@/lib/dashboard/ai-spend";

/**
 * The window's spend as one vertical stick gauge per date.
 *
 * A gauge, not a column: the busiest day in the window is the full height, and
 * every other date is filled to its own share of it — the same reading as
 * `HorizontalStickGauge`, stood on its end and repeated once per date. A date
 * with no spend draws nothing at all rather than a zero-height stub, and a date
 * that spent a fraction of a cent still draws a dot, because "a little" and
 * "nothing" are different facts.
 *
 * Two things this replaced, both from the card growing. It drew into a **fixed
 * 480×224 viewBox** the browser then scaled to the card's width, so at two
 * columns every stick was stretched ~1.7× into a block. And each date was a
 * *column* of eight or so stacked bricks whose colours carried the activity
 * split — five categories inside three sticks per day, which nothing can read.
 * The split is `AiSpendActivityGauge`'s job now; a date's own mix is still
 * available on hover, one date at a time.
 *
 * Geometry is the gauge's: a measured width, a 3px rounded stroke, `--lead` for
 * the value. Only the pitch varies with the number of dates — 8.5px is the
 * gauge's own rhythm and what a 90-day window lands on, while a year's worth of
 * dates close up into the dense row a year should look like.
 */

const HEIGHT = 156;
/** Room for the axis figures (`$12.40`). */
const GUTTER = 48;
const TOP = 10;
const BOTTOM = 20;
const RIGHT = 4;
/** Stroke width — the gauge's own, and what a stick stays at however wide the card is. */
const STICK = 3;
const TICKS = 4;
/** A date that spent anything shows at least a dot, never nothing at all. */
const MIN_STICK = 2.5;

type DaySpend = AiSpendBucket & { label: string };

function utcDay(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every day in the period, including the ones with nothing on them. */
function dailySpend(summary: AiSpendSummary, withYear: boolean): DaySpend[] {
  const byDay = new Map(summary.spendByDay.map((bucket) => [bucket.key, bucket]));
  const days: DaySpend[] = [];
  const end = utcDay(summary.periodTo).getTime();

  for (let day = utcDay(summary.periodFrom); day.getTime() <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const key = isoDay(day);
    const bucket = byDay.get(key);
    days.push(
      bucket ?? {
        key,
        label: formatSpendDay(key, withYear),
        totalCostUsd: 0,
        byActivity: {
          initial_email: 0,
          email_regeneration: 0,
          follow_up_email: 0,
          client_booklet: 0,
          other: 0,
        },
      },
    );
  }

  return days;
}

function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => normalised <= candidate) ?? 10;
  return step * magnitude;
}

function axisMaximum(days: DaySpend[]): number {
  const maximum = Math.max(...days.map((day) => day.totalCostUsd), 0);
  return niceStep(maximum / (TICKS - 1)) * (TICKS - 1);
}

/**
 * The one activity that took the larger share of a date's spend, or null on a
 * date with nothing on it. Offered where it *can* be read — one date at a time,
 * on hover — rather than encoded in three sticks of colour.
 */
function busiestActivity(day: DaySpend): AiGenerationActivity | null {
  return AI_GENERATION_ACTIVITIES.reduce<AiGenerationActivity | null>((best, activity) => {
    if (day.byActivity[activity] <= 0) return best;
    if (best === null) return activity;
    return day.byActivity[activity] > day.byActivity[best] ? activity : best;
  }, null);
}

/** First, middle and last — a label under every date is a solid grey band. */
function xLabels(days: DaySpend[]): number[] {
  if (days.length <= 3) return days.map((_, index) => index);
  const middle = Math.floor((days.length - 1) / 2);
  return [0, middle, days.length - 1];
}

export function AiSpendDailyChart({ summary }: { summary: AiSpendSummary }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const measure = (measured: number) => {
      if (measured > 0) setWidth(measured);
    };
    measure(node.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /** A window that crosses a year names the year, or its ends read as one date. */
  const withYear = aiSpendSpansYears(summary);

  const days = useMemo(() => dailySpend(summary, withYear), [summary, withYear]);
  const max = useMemo(() => axisMaximum(days), [days]);
  const hasSpend = days.some((day) => day.totalCostUsd > 0);

  const plotWidth = Math.max(1, width - GUTTER - RIGHT);
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const baseline = TOP + plotHeight;
  const band = plotWidth / days.length;
  // One stick per date, spaced by the date's own share of the plot. A year of
  // dates is narrower than a stick, so the stroke gives way to the spacing
  // rather than the dates overlapping into a single smear.
  const stick = Math.max(1, Math.min(STICK, band - 1));
  const dayX = (index: number) => GUTTER + index * band + band / 2;

  const yTicks = hasSpend ? Array.from({ length: TICKS }, (_, index) => index) : [0];
  const busiest = days.reduce<DaySpend | null>(
    (result, day) => (result && result.totalCostUsd >= day.totalCostUsd ? result : day),
    null,
  );
  const range = aiSpendRangeLabel(summary);

  // Drawn only once the container is measured. A guess at the width would either
  // spill past a narrow card or sit small in a wide one until the first frame
  // lands; an empty band for that frame is the cheaper lie, and the container
  // holds the height so nothing below it moves.
  const chart = (
    <svg
      role="img"
      aria-label={
        hasSpend && busiest
          ? `AI spend by date, ${range}. Busiest date ${busiest.label}, ${formatUsd(busiest.totalCostUsd)}.`
          : `AI spend by date, ${range}`
      }
      height={HEIGHT}
      className="block w-full overflow-visible"
    >
      {yTicks.map((index) => {
        const value = hasSpend ? (max / (TICKS - 1)) * index : 0;
        const y = hasSpend ? baseline - (plotHeight / (TICKS - 1)) * index : baseline;
        return (
          <g key={value}>
            <line
              x1={GUTTER}
              x2={GUTTER + plotWidth}
              y1={y}
              y2={y}
              stroke="var(--rule-soft)"
            />
            <text
              x={GUTTER - 8}
              y={y + 3.5}
              textAnchor="end"
              fill="var(--dim)"
              className="font-body text-[10px]"
            >
              {formatUsd(value)}
            </text>
          </g>
        );
      })}

      <line
        x1={GUTTER}
        x2={GUTTER + plotWidth}
        y1={baseline}
        y2={baseline}
        stroke="var(--rule)"
      />

      {days.map((day, index) => {
        const share = hasSpend && max > 0 ? day.totalCostUsd / max : 0;
        const height = share > 0 ? Math.max(MIN_STICK, share * plotHeight) : 0;
        // Round caps add half a stroke at each end; the visible stick is
        // `height` tall and its foot sits on the baseline.
        const foot = baseline - stick / 2;
        const head = foot - Math.max(0, height - stick);
        const activity = busiestActivity(day);

        return (
          <g key={day.key}>
            <title>
              {`${day.label}: ${formatUsd(day.totalCostUsd)}`}
              {activity
                ? `, mostly ${AI_GENERATION_ACTIVITY_LABELS[activity].toLowerCase()}`
                : ""}
            </title>
            {/* A year of dates is about two pixels apart, which nobody can point
                at. The whole date's band answers the pointer instead. */}
            <rect
              x={GUTTER + index * band}
              y={TOP}
              width={band}
              height={plotHeight}
              fill="transparent"
              pointerEvents="all"
            />
            {height > 0 && (
              <line
                x1={dayX(index)}
                x2={dayX(index)}
                y1={head}
                y2={foot}
                stroke="var(--lead)"
                strokeWidth={stick}
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}

      {xLabels(days).map((index) => {
        const isFirst = index === 0;
        const isLast = index === days.length - 1;
        return (
          <text
            key={index}
            x={isFirst ? GUTTER : isLast ? GUTTER + plotWidth : dayX(index)}
            y={baseline + 15}
            textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
            fill="var(--dim)"
            className="font-body text-[10px]"
          >
            {days[index].label}
          </text>
        );
      })}

      {!hasSpend && (
        <text
          x={GUTTER + plotWidth / 2}
          y={baseline - plotHeight / 2}
          textAnchor="middle"
          fill="var(--dim)"
          className="font-body text-[12px]"
        >
          No priced AI spend in this period
        </text>
      )}
    </svg>
  );

  return (
    <div ref={containerRef} className="w-full" style={{ height: HEIGHT }}>
      {width > 0 && chart}
    </div>
  );
}

export default AiSpendDailyChart;
