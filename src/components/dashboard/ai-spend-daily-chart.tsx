"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  AI_GENERATION_ACTIVITIES,
  AI_GENERATION_ACTIVITY_COLOURS,
  AI_GENERATION_ACTIVITY_LABELS,
  aiSpendRangeLabel,
  aiSpendSpansYears,
  formatShare,
  formatSpendDay,
  formatUsd,
  type AiGenerationActivity,
  type AiSpendBucket,
  type AiSpendSummary,
} from "@/lib/dashboard/ai-spend";

/**
 * The window's spend as one vertical stick per date, split by kind of work.
 *
 * A time series, not a gauge: the y-axis on the left names the money and the
 * x-axis along the bottom names the dates, and each date gets a single stick
 * whose height is that date's spend against the axis maximum. The stick is
 * split bottom-up into one segment per activity that spent anything that day,
 * in the activity gauge's own colours, so a date reads as "how much" from its
 * height and "on what" from its colours — the same split `AiSpendActivityGauge`
 * shows for the whole window, repeated once per date.
 *
 * Segments stack in the canonical activity order (initial email at the foot,
 * Other at the head) so the same kind of work sits in the same relative place
 * on every date. A date with no spend draws nothing at all rather than a
 * zero-height stub, and a date that spent a fraction of a cent still draws a
 * dot in its busiest activity's colour, because "a little" and "nothing" are
 * different facts. The full per-activity breakdown of a date is on hover, one
 * date at a time.
 *
 * Geometry is the gauge's: a measured width, a 3px rounded stroke. Only the
 * pitch varies with the number of dates — a year's worth of dates close up
 * into the dense row a year should look like, and the stroke gives way to the
 * spacing rather than the dates overlapping into a single smear.
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

type DaySegment = {
  activity: AiGenerationActivity;
  costUsd: number;
  shareOfDay: number;
};

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
 * A date's spend as one segment per activity that spent anything, in the
 * canonical activity order so the same work sits in the same place on every
 * date. The shares add up to the date's whole.
 */
function daySegments(day: DaySpend): DaySegment[] {
  if (day.totalCostUsd <= 0) return [];
  return AI_GENERATION_ACTIVITIES.flatMap((activity) => {
    const costUsd = day.byActivity[activity];
    if (costUsd <= 0) return [];
    return [{ activity, costUsd, shareOfDay: costUsd / day.totalCostUsd }];
  });
}

/** The one activity that took the larger share of a date's spend, for the dot. */
function busiestActivity(day: DaySpend): AiGenerationActivity | null {
  return AI_GENERATION_ACTIVITIES.reduce<AiGenerationActivity | null>((best, activity) => {
    if (day.byActivity[activity] <= 0) return best;
    if (best === null) return activity;
    return day.byActivity[activity] > day.byActivity[best] ? activity : best;
  }, null);
}

/**
 * Which dates name themselves along the x-axis: first and last always, and as
 * many evenly spaced dates between as the measured width can hold without the
 * labels running into each other. A label under every date is a solid grey
 * band; three labels on a wide card is a bare axis.
 */
function xLabelIndices(dayCount: number, width: number): number[] {
  if (dayCount <= 0) return [];
  const capacity = width > 520 ? 6 : width > 380 ? 4 : 3;
  if (dayCount <= capacity) return daysRange(dayCount);
  const indices = new Set<number>();
  for (let slot = 0; slot < capacity; slot += 1) {
    indices.add(Math.round((slot * (dayCount - 1)) / (capacity - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

function daysRange(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/** A date's hover reading: the total, then each activity's own figure. */
function dayTitle(day: DaySpend, segments: DaySegment[]): string {
  const head = `${day.label}: ${formatUsd(day.totalCostUsd)}`;
  if (segments.length <= 1) return head;
  const ordered = [...segments].sort((a, b) => b.costUsd - a.costUsd);
  const parts = ordered.map(
    (segment) =>
      `${AI_GENERATION_ACTIVITY_LABELS[segment.activity]} ${formatUsd(segment.costUsd)} (${formatShare(segment.shareOfDay)})`,
  );
  return `${head} — ${parts.join(", ")}`;
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
  const band = plotWidth / Math.max(1, days.length);
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
  const labelled = xLabelIndices(days.length, width);

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
        const rawHeight = share > 0 ? share * plotHeight : 0;
        // A date that spent a fraction of a cent still draws a dot, but a dot
        // is one mark and cannot carry a split — it takes its busiest
        // activity's colour and the breakdown stays on hover.
        const isDot = rawHeight > 0 && rawHeight <= MIN_STICK;
        const height = rawHeight > 0 ? Math.max(MIN_STICK, rawHeight) : 0;
        const allSegments = daySegments(day);
        const segments = isDot ? [] : allSegments;
        const activity = busiestActivity(day);

        return (
          <g key={day.key}>
            <title>{dayTitle(day, allSegments)}</title>
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
            {height > 0 && segments.length <= 1 && activity && (
              <line
                x1={dayX(index)}
                x2={dayX(index)}
                // Round caps add half a stroke at each end; the visible stick
                // is `height` tall and its foot sits on the baseline.
                y1={baseline - stick / 2 - Math.max(0, height - stick)}
                y2={baseline - stick / 2}
                stroke={AI_GENERATION_ACTIVITY_COLOURS[activity]}
                strokeWidth={stick}
                strokeLinecap="round"
              />
            )}
            {height > 0 && segments.length > 1 && (
              <g>
                {segments.map((segment, segmentIndex) => {
                  const isTop = segmentIndex === segments.length - 1;
                  // Heights below this one, so this segment starts where the
                  // last one ended. The foot sits exactly on the baseline and
                  // the head reaches exactly `height` above it; only the top
                  // segment keeps the stick's round cap.
                  const below = segments
                    .slice(0, segmentIndex)
                    .reduce((total, earlier) => total + earlier.shareOfDay * height, 0);
                  const segmentHeight = segment.shareOfDay * height;
                  const bottom = baseline - below;
                  const top = baseline - below - segmentHeight + (isTop ? stick / 2 : 0);
                  return (
                    <line
                      key={segment.activity}
                      x1={dayX(index)}
                      x2={dayX(index)}
                      y1={top}
                      y2={bottom}
                      stroke={AI_GENERATION_ACTIVITY_COLOURS[segment.activity]}
                      strokeWidth={stick}
                      strokeLinecap={isTop ? "round" : "butt"}
                    />
                  );
                })}
              </g>
            )}
          </g>
        );
      })}

      {labelled.map((index) => {
        const isFirst = index === 0;
        const isLast = index === days.length - 1;
        const day = days[index];
        if (!day) return null;
        return (
          <text
            key={index}
            x={isFirst ? GUTTER : isLast ? GUTTER + plotWidth : dayX(index)}
            y={baseline + 15}
            textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
            fill="var(--dim)"
            className="font-body text-[10px]"
          >
            {day.label}
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
