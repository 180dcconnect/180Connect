"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";

import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { LoaderPinwheel } from "@/components/animate-ui/icons/loader-pinwheel";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import {
  AI_GENERATION_ACTIVITIES,
  AI_GENERATION_ACTIVITY_COLOURS,
  AI_GENERATION_ACTIVITY_LABELS,
  aiSpendActivityRows,
  aiSpendChange,
  aiSpendRangeLabel,
  aiSpendSpansYears,
  formatShare,
  formatSpendDay,
  formatUsd,
  type AiGenerationActivity,
  type AiSpendBucket,
  type AiSpendPeriodId,
  type AiSpendReading,
  type AiSpendSummary,
} from "@/lib/dashboard/ai-spend";

/**
 * F213 — AI spend, admin only, in the overview shape.
 *
 * One stacked-stick column per date (thin horizontal sticks, one colour per
 * kind of work), a spend headline with the delta against the equal-length
 * prior stretch, a 7D–ALL window choice, and the window's own split as the
 * app's horizontal sticks. Every window is computed on the server off one
 * fetch (`aiSpendReadings`), so switching is a re-read of figures already in
 * the browser, not a query.
 *
 * Unpriced generations are surfaced, never folded into the total as zero: the
 * headline is honestly a floor when the provider gave us no usage data, and a
 * spend figure that quietly understates itself is worse than no figure.
 */

/** Pill words per window — the control is a choice, not a config value. */
const PERIOD_PILLS: Record<AiSpendPeriodId, string> = {
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  ytd: "YTD",
  "365d": "1Y",
  all: "ALL",
};

const PLOT_HEIGHT = 252;
const TOP = 8;
const BOTTOM = 26;
const GUTTER = 48;
const RIGHT = 8;
const TICKS = 5;
/** Sticks in the busiest column — enough that a 3px stick plus gap fills the plot. */
const MAX_STICKS = 36;
const STICK_HEIGHT = 3;
const STICK_PITCH = 6;
/** Past this many columns the fill-up cascade becomes hundreds of animated
    nodes, so dense windows draw plain sticks instead. */
const ANIMATED_COLUMN_LIMIT = 31;

type DaySpend = AiSpendBucket & { label: string; tooltipLabel?: string };

/** Above this many individual dates, daily sticks are too thin to read as
    separate bars, so the window groups into weeks; past that, months. */
const WEEKLY_ABOVE_DAYS = 31;
const MONTHLY_ABOVE_DAYS = 120;

function utcDay(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `date`. */
function weekStart(date: Date): Date {
  const start = new Date(date);
  const weekday = start.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  start.setUTCDate(start.getUTCDate() + diff);
  return start;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const emptyActivityTotals = (): Record<AiGenerationActivity, number> => ({
  initial_email: 0,
  email_regeneration: 0,
  follow_up_email: 0,
  client_booklet: 0,
  other: 0,
});

/** Every day in the window, including the ones with nothing on them. */
function dailySpend(summary: AiSpendSummary, withYear: boolean): DaySpend[] {
  const byDay = new Map(summary.spendByDay.map((bucket) => [bucket.key, bucket]));
  const days: DaySpend[] = [];
  const end = utcDay(summary.periodTo).getTime();

  for (let day = utcDay(summary.periodFrom); day.getTime() <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const key = isoDay(day);
    const bucket = byDay.get(key);
    days.push(
      bucket
        ? { ...bucket, label: formatSpendDay(key, withYear) }
        : {
            key,
            label: formatSpendDay(key, withYear),
            totalCostUsd: 0,
            byActivity: emptyActivityTotals(),
          },
    );
  }

  return days;
}

/**
 * Groups daily buckets into weeks (Monday-start) or calendar months, summing
 * cost and activity split per bucket. Long windows read as one bar per date
 * would otherwise cram dozens of hairline sticks into the same plot width.
 */
function groupedSpend(days: DaySpend[], granularity: "week" | "month", withYear: boolean): DaySpend[] {
  const order: string[] = [];
  const buckets = new Map<
    string,
    { start: Date; end: Date; totalCostUsd: number; byActivity: Record<AiGenerationActivity, number> }
  >();

  for (const day of days) {
    const date = utcDay(day.key);
    const key = granularity === "week" ? isoDay(weekStart(date)) : monthKey(date);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { start: date, end: date, totalCostUsd: 0, byActivity: emptyActivityTotals() };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.end = date;
    bucket.totalCostUsd += day.totalCostUsd;
    for (const activity of AI_GENERATION_ACTIVITIES) bucket.byActivity[activity] += day.byActivity[activity];
  }

  return order.map((key) => {
    const bucket = buckets.get(key)!;
    if (granularity === "week") {
      const startLabel = formatSpendDay(isoDay(bucket.start), withYear);
      const endLabel = formatSpendDay(isoDay(bucket.end), withYear);
      return {
        key,
        label: startLabel,
        tooltipLabel: startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`,
        totalCostUsd: bucket.totalCostUsd,
        byActivity: bucket.byActivity,
      };
    }
    return {
      key,
      label: bucket.start.toLocaleDateString("en-GB", {
        month: "short",
        year: withYear ? "numeric" : undefined,
        timeZone: "UTC",
      }),
      tooltipLabel: bucket.start.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      totalCostUsd: bucket.totalCostUsd,
      byActivity: bucket.byActivity,
    };
  });
}

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => normalised <= candidate) ?? 10;
  return step * magnitude;
}

/**
 * A date's total dealt into whole sticks across the activities that spent,
 * largest remainder first — the gauge's own dealing, stood on end. Tiny slices
 * on small dates win no sticks; the tooltip still names their exact figures.
 */
function dealColumnSticks(byActivity: Record<AiGenerationActivity, number>, dayTotal: number, count: number): AiGenerationActivity[] {
  const entries = AI_GENERATION_ACTIVITIES.map((activity) => ({ activity, value: byActivity[activity] })).filter(
    (entry) => entry.value > 0,
  );
  if (entries.length === 0 || count <= 0 || dayTotal <= 0) return [];

  const base = entries.map((entry) => Math.floor((entry.value / dayTotal) * count));
  let rest = count - base.reduce((sum, sticks) => sum + sticks, 0);
  const order = entries
    .map((entry, index) => index)
    .sort(
      (a, b) =>
        ((entries[b].value / dayTotal) * count) % 1 - ((entries[a].value / dayTotal) * count) % 1 ||
        entries[b].value - entries[a].value,
    );
  const extra = new Array<number>(entries.length).fill(0);
  for (let round = 0; rest > 0; round += 1) {
    extra[order[round % order.length]] += 1;
    rest -= 1;
  }

  // Canonical activity order bottom-up, so one kind of work sits in the same
  // relative place on every date.
  const sticks: AiGenerationActivity[] = [];
  for (const activity of AI_GENERATION_ACTIVITIES) {
    const index = entries.findIndex((entry) => entry.activity === activity);
    if (index >= 0) {
      for (let stick = 0; stick < base[index] + extra[index]; stick += 1) sticks.push(activity);
    }
  }
  return sticks;
}

/**
 * Which dates name themselves along the x-axis: first and last always, and as
 * many evenly spaced dates between as the measured width can hold without the
 * labels running into each other.
 */
function xLabelIndices(dayCount: number, width: number): number[] {
  if (dayCount <= 0) return [];
  const capacity = width > 520 ? 6 : width > 380 ? 4 : 3;
  if (dayCount <= capacity) return Array.from({ length: dayCount }, (_, index) => index);
  const indices = new Set<number>();
  for (let slot = 0; slot < capacity; slot += 1) {
    indices.add(Math.round((slot * (dayCount - 1)) / (capacity - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

export function AiSpendOverviewPreview({ readings }: { readings: AiSpendReading[] }) {
  const [periodId, setPeriodId] = useState<AiSpendPeriodId>("30d");
  const [hovered, setHovered] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [iconIntro, setIconIntro] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIconIntro(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

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

  const reading = readings.find((candidate) => candidate.period.id === periodId) ?? readings[0];
  if (!reading) return null;

  const { period, summary } = reading;
  const change = aiSpendChange(summary);
  const rising = change !== null && change > 0;
  const rows = aiSpendActivityRows(summary);
  const hasPriced = summary.costUsd > 0;

  /** A window that crosses a year names the year, or its ends read as one date. */
  const withYear = aiSpendSpansYears(summary);
  const rawDays = dailySpend(summary, withYear);
  const granularity: "day" | "week" | "month" =
    rawDays.length <= WEEKLY_ABOVE_DAYS ? "day" : rawDays.length <= MONTHLY_ABOVE_DAYS ? "week" : "month";
  const days = granularity === "day" ? rawDays : groupedSpend(rawDays, granularity, withYear);
  const totals = days.map((day) => day.totalCostUsd);
  const max = niceCeiling(Math.max(...totals, 0) / (TICKS - 1)) * (TICKS - 1);
  const hasSpend = days.some((day) => day.totalCostUsd > 0);
  const range = aiSpendRangeLabel(summary);
  const busiest = days.reduce<DaySpend | null>(
    (result, day) => (result && result.totalCostUsd >= day.totalCostUsd ? result : day),
    null,
  );

  /** The window's own activity split, for the gauge row. */
  const gaugeSegments = rows
    .filter((row) => row.costUsd > 0)
    .map((row) => ({
      id: row.activity,
      label: row.label,
      value: row.costUsd,
      color: row.colour,
    }));

  const plotWidth = Math.max(1, width - GUTTER - RIGHT);
  const plotHeight = PLOT_HEIGHT - TOP - BOTTOM;
  const baseline = TOP + plotHeight;
  const slot = plotWidth / Math.max(1, days.length);
  const stickWidth = Math.max(1, Math.min(18, slot - 1));
  const centre = (groupIndex: number) => GUTTER + slot * (groupIndex + 0.5);
  const animateCascade = days.length <= ANIMATED_COLUMN_LIMIT;
  const labelled = xLabelIndices(days.length, width);

  const hoveredGroup = hovered !== null ? days[hovered] : null;
  const hoveredLeftPct = hovered !== null ? ((GUTTER + slot * (hovered + 0.5)) / Math.max(1, width)) * 100 : 0;

  return (
    <section
      aria-labelledby="ai-spend-heading"
      className="overflow-hidden rounded-panel border border-rule bg-white"
    >
      {/* Header: pulse mark, title, and the view all generations action button. */}
      <div className="flex items-center justify-between gap-4 border-b border-rule-soft px-5 py-3.5 sm:px-6">
        <h2
          id="ai-spend-heading"
          className="flex items-center gap-2 font-body text-[15px] font-semibold tracking-[-0.01em] text-ink"
        >
          <AnimateIcon animate={iconIntro} animateOnHover={true}>
            <LoaderPinwheel size={18} className="text-faint" />
          </AnimateIcon>
          AI Spend
        </h2>
        <Link
          href="/admin/ai-generations"
          className="shrink-0 rounded-inset bg-lead px-3 py-1.5 font-body text-[13px] font-semibold text-white transition-colors hover:bg-stop/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stop"
        >
          View all generations
        </Link>
      </div>

      {/* Spend headline and the window choice. */}
      <div className="grid items-start gap-x-6 gap-y-4 px-5 pt-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-body text-[30px] leading-none font-bold tracking-[-0.02em] tabular-nums text-ink">
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
                Nothing was spent in {period.comparison}, so there is nothing to compare this with yet.
              </span>
            ) : (
              <span className={`font-semibold ${rising ? "text-stop" : "text-go"}`}>
                {rising ? "Up" : "Down"} {Math.abs(change).toFixed(0)}% on {period.comparison}
              </span>
            )}
          </p>
        </div>

        <div className="flex min-w-0 flex-col items-start gap-2.5 md:items-end">
          <div
            role="group"
            aria-label="How far back these figures look"
            className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[10px] bg-paper p-1"
          >
            {readings.map((candidate) => {
              const selected = candidate.period.id === period.id;
              return (
                <button
                  key={candidate.period.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setPeriodId(candidate.period.id);
                    setHovered(null);
                  }}
                  className={`shrink-0 cursor-pointer rounded-[7px] px-3.5 py-1.5 font-body text-[13px] font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-lead ${
                    selected ? "bg-white text-ink shadow-sm" : "text-dim hover:text-ink"
                  }`}
                >
                  {PERIOD_PILLS[candidate.period.id]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* The window's split as the app's own horizontal sticks, below the headline reading. */}
      <div className="px-5 pt-8 pb-6 sm:px-6 sm:pb-8">
        <h3 className="font-body text-[14px] font-semibold text-ink">What it went on</h3>
        {hasPriced ? (
          <>
            <div className="mt-2.5">
              <HorizontalStickGauge
                segments={gaugeSegments}
                ariaLabel={`What this window's AI spend went on, ${period.label.toLowerCase()}`}
                valueFormatter={formatUsd}
              />
            </div>
            {/* The legend carries the figures, not just the colours. A category
                that ran without ever being billed keeps its row and says so. */}
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
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

      {/* One stacked-stick column per date: thin horizontal sticks, one colour
          per kind of work, height against the dollar axis. */}
      <div ref={containerRef} className="relative mx-2 mt-2 px-3 sm:mx-4 mb-4" style={{ height: PLOT_HEIGHT }}>
        {width > 0 && (
          <svg
            role="img"
            aria-label={
              hasSpend && busiest
                ? `AI spend by date, ${range}. Busiest ${busiest.tooltipLabel ?? busiest.label}, ${formatUsd(busiest.totalCostUsd)}.`
                : `AI spend by date, ${range}`
            }
            className="block w-full"
            height={PLOT_HEIGHT}
          >
            {Array.from({ length: TICKS }, (_, index) => {
              const value = (max / (TICKS - 1)) * index;
              const y = baseline - (plotHeight / (TICKS - 1)) * index;
              return (
                <g key={index}>
                  <line x1={GUTTER} x2={GUTTER + plotWidth} y1={y} y2={y} stroke="var(--rule-soft)" strokeDasharray="4 4" />
                  <text x={GUTTER - 8} y={y + 3.5} textAnchor="end" fill="var(--faint)" className="font-body text-[10.5px]">
                    {formatUsd(value)}
                  </text>
                </g>
              );
            })}

            {days.map((day, groupIndex) => {
              const total = totals[groupIndex] ?? 0;
              const count = total > 0 && max > 0 ? Math.max(1, Math.round((total / max) * MAX_STICKS)) : 0;
              const sticks = dealColumnSticks(day.byActivity, total, count);
              const ordered = [...AI_GENERATION_ACTIVITIES]
                .map((activity) => ({ activity, value: day.byActivity[activity] }))
                .filter((entry) => entry.value > 0)
                .sort((a, b) => b.value - a.value);
              return (
                <g key={`${day.key}-${groupIndex}`}>
                  {hovered === groupIndex && (
                    <rect
                      x={GUTTER + slot * groupIndex + 2}
                      y={TOP - 4}
                      width={Math.max(1, slot - 4)}
                      height={plotHeight + 8}
                      rx={8}
                      fill="var(--paper)"
                      opacity={0.7}
                    />
                  )}
                  {sticks.map((activity, stickIndex) => {
                    const geometry = {
                      x: centre(groupIndex) - stickWidth / 2,
                      y: baseline - (stickIndex + 1) * STICK_PITCH + (STICK_PITCH - STICK_HEIGHT),
                      width: stickWidth,
                      height: STICK_HEIGHT,
                      rx: 1.5,
                      fill: AI_GENERATION_ACTIVITY_COLOURS[activity],
                    };
                    return animateCascade ? (
                      <motion.rect
                        key={stickIndex}
                        {...geometry}
                        // Fill-up cascade: stick 0 sits at the foot of the
                        // column, so delaying by stick index lays the column
                        // bottom to top, one column after the previous.
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.28,
                          ease: [0.2, 0.7, 0.2, 1],
                          delay:
                            Math.min(groupIndex * 0.05, 0.45) +
                            Math.min(stickIndex * 0.022, 0.7),
                        }}
                      />
                    ) : (
                      <rect key={stickIndex} {...geometry} />
                    );
                  })}
                  {labelled.includes(groupIndex) && (
                    <text
                      x={
                        groupIndex === 0
                          ? GUTTER
                          : groupIndex === days.length - 1
                            ? GUTTER + plotWidth
                            : centre(groupIndex)
                      }
                      y={baseline + 17}
                      textAnchor={groupIndex === 0 ? "start" : groupIndex === days.length - 1 ? "end" : "middle"}
                      fill="var(--faint)"
                      className="font-body text-[10.5px]"
                    >
                      {day.label}
                    </text>
                  )}
                  <rect
                    x={GUTTER + slot * groupIndex}
                    y={TOP}
                    width={slot}
                    height={plotHeight}
                    fill="transparent"
                    pointerEvents="all"
                    onPointerEnter={() => setHovered(groupIndex)}
                    onPointerLeave={() => setHovered((current) => (current === groupIndex ? null : current))}
                  >
                    <title>
                      {`${day.tooltipLabel ?? day.label}: ${formatUsd(total)}${ordered.length > 1 ? ` — ${ordered.map((entry) => `${AI_GENERATION_ACTIVITY_LABELS[entry.activity]} ${formatUsd(entry.value)}`).join(", ")}` : ""}`}
                    </title>
                  </rect>
                </g>
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
        )}

        {/* Floating tooltip over the hovered column, clamped inside the card. */}
        {hoveredGroup && hovered !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-6 z-10 w-60 -translate-x-1/2 rounded-xl border border-rule-soft bg-white px-4 py-3 shadow-lg"
            style={{ left: `max(7.5rem, min(calc(100% - 7.5rem), ${hoveredLeftPct}%))` }}
          >
            <p className="font-body text-[13px] font-bold text-ink">
              {hoveredGroup.tooltipLabel ?? hoveredGroup.label}
            </p>
            <ul className="mt-2 space-y-1.5 font-body text-[12.5px]">
              {[...AI_GENERATION_ACTIVITIES]
                .map((activity) => ({ activity, value: hoveredGroup.byActivity[activity] }))
                .filter((entry) => entry.value > 0)
                .sort((a, b) => b.value - a.value)
                .map((entry) => (
                  <li key={entry.activity} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-dim">
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: AI_GENERATION_ACTIVITY_COLOURS[entry.activity] }}
                      />
                      {AI_GENERATION_ACTIVITY_LABELS[entry.activity]}:
                    </span>
                    <span className="font-bold tabular-nums text-ink">{formatUsd(entry.value)}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      {/* Usage figures below the chart: what the window cost in tokens and
          models, and the generations that carried no cost. */}
      {(summary.generations > 0 || summary.unpriced > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pt-4 pb-5 sm:px-6">
          {summary.generations > 0 && (
            <p className="font-body text-[13.5px] leading-[1.55] text-dim">
              {summary.totalTokens.toLocaleString()} tokens
              {summary.models.length > 0 ? ` · ${summary.models.join(", ")}` : ""}
            </p>
          )}
          {summary.unpriced > 0 && (
            <p className="font-body text-[12.5px] leading-[1.55] text-dim">
              {summary.unpriced.toLocaleString()} {summary.unpriced === 1 ? "generation" : "generations"} carried no cost — the
              provider reported no usage, or no pricing row covered the model. The figure above is a floor.
            </p>
          )}
        </div>
      )}

    </section>
  );
}

export default AiSpendOverviewPreview;
