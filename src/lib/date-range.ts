/**
 * The pure half of the custom date-range calendar (see
 * @/components/ui/date-range-calendar.tsx) — month grids, range selection
 * rules, and bounds. No React, no DOM, no `Intl` in the parts that matter, so
 * every rule here is testable without rendering anything.
 *
 * REPLACES `<input type="date">` in the metric period picker, and the reasons
 * are worth recording because they are not only cosmetic:
 *
 * - The native picker is browser chrome, not a DOM node. The period popover
 *   closes itself on blur when focus leaves its subtree, and a browser-drawn
 *   calendar is not in that subtree — so opening the native picker could dismiss
 *   the popover underneath it mid-selection.
 * - Two independent single-date inputs for one range meant the user operated two
 *   controls to express one intention, and could not see the span they were
 *   choosing until after they had chosen it.
 * - `type="date"` formats to the OS locale. The rest of this app formats en-GB,
 *   so a US-locale machine showed `08/12/2026` in the field and "12 Aug" in the
 *   label directly above it.
 *
 * EVERYTHING IS A UTC ISO DAY (`YYYY-MM-DD`), the same string the period picker
 * already passes around, for the same reason the rest of the dashboard does it:
 * ISO days sort and compare correctly as plain strings, and a local-midnight
 * Date would put a London user's "1 September" an hour before the UTC one.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday-first, matching the app's en-GB formatting rather than the US default. */
export const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * Always six rows. A month needing five would otherwise make the calendar
 * shorter, and the popover animates its own height — so the box would resize
 * every time you paged between months.
 */
export const GRID_ROWS = 6;
export const GRID_CELLS = GRID_ROWS * 7;

export type DayCell = {
  /** `YYYY-MM-DD`, UTC. */
  iso: string;
  dayOfMonth: number;
  /** False for the leading/trailing days borrowed from the neighbouring months. */
  inMonth: boolean;
};

/** `YYYY-MM` — the calendar's paging unit. */
export type MonthKey = string;

export type RangeSelection = { from: string | null; to: string | null };

export type DayFlags = {
  /** The first day of the selected (or previewed) range. */
  isStart: boolean;
  /** The last day of it. */
  isEnd: boolean;
  /** Strictly inside the range — neither end. */
  isInside: boolean;
  /** Any part of the range, ends included. Convenience for styling the track. */
  isInRange: boolean;
  /** The range is a hover preview, not a committed selection. */
  isPreview: boolean;
  isToday: boolean;
  /** Outside `min`/`max`; not selectable. */
  isDisabled: boolean;
};

/** Midnight UTC of an ISO day, in ms; null when the string isn't one. */
export function parseIsoDay(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toIsoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today as a UTC ISO day — the calendar's "today" ring. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function monthKeyOf(iso: string): MonthKey {
  return iso.slice(0, 7);
}

/** `YYYY-MM` shifted by whole months, rolling the year over correctly. */
export function addMonths(month: MonthKey, delta: number): MonthKey {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const shifted = new Date(Date.UTC(year, index + delta, 1));
  return toIsoDay(shifted.getTime()).slice(0, 7);
}

/** "August 2026". The one place `Intl` is used, and it is display-only. */
export function monthLabel(month: MonthKey): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The 42 cells of a month's grid, Monday-first, including the borrowed days
 * either side so the first row is never ragged.
 */
export function buildMonthGrid(month: MonthKey): DayCell[] {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const firstOfMonth = Date.UTC(year, index, 1);

  // getUTCDay(): 0 = Sunday. Shift so Monday is 0 — the same conversion
  // weekWindows() in performance-metrics.ts uses for ISO weeks.
  const leading = (new Date(firstOfMonth).getUTCDay() + 6) % 7;
  const gridStart = firstOfMonth - leading * DAY_MS;

  const cells: DayCell[] = [];
  for (let i = 0; i < GRID_CELLS; i += 1) {
    const ms = gridStart + i * DAY_MS;
    const date = new Date(ms);
    cells.push({
      iso: toIsoDay(ms),
      dayOfMonth: date.getUTCDate(),
      inMonth: date.getUTCMonth() === index && date.getUTCFullYear() === year,
    });
  }
  return cells;
}

/** Low/high ends of a pair of ISO days, whichever way round they arrive. */
export function orderPair(a: string, b: string): { lo: string; hi: string } {
  return a <= b ? { lo: a, hi: b } : { lo: b, hi: a };
}

export type DayFlagsContext = {
  selection: RangeSelection;
  /** The day under the cursor, used to preview the range before the second click. */
  hover?: string | null;
  /** Inclusive selectable bounds; omit for unbounded. */
  min?: string | null;
  max?: string | null;
  today?: string;
};

/**
 * What a single day looks like right now.
 *
 * The preview is the reason `hover` exists: with a start picked and no end, the
 * range under the cursor is drawn as though it were selected, so the user sees
 * the span they are about to commit to instead of finding out afterwards. It is
 * marked `isPreview` so the UI can render it lighter than a real selection.
 */
export function dayFlags(iso: string, context: DayFlagsContext): DayFlags {
  const { selection, hover, min, max, today } = context;

  const isDisabled = Boolean((min && iso < min) || (max && iso > max));

  // A committed range needs both ends. With only a start, the hovered day
  // stands in for the end — but never when it is out of bounds, or the preview
  // would run into days that cannot be picked.
  const previewEnd =
    selection.from && !selection.to && hover && !(min && hover < min) && !(max && hover > max)
      ? hover
      : null;
  const isPreview = previewEnd !== null;

  const effectiveEnd = selection.to ?? previewEnd;

  if (!selection.from || !effectiveEnd) {
    // Nothing spanned yet: a lone start still draws as a start, so the first
    // click visibly lands.
    return {
      isStart: selection.from === iso,
      isEnd: false,
      isInside: false,
      isInRange: selection.from === iso,
      isPreview: false,
      isToday: today === iso,
      isDisabled,
    };
  }

  const { lo, hi } = orderPair(selection.from, effectiveEnd);
  const isInRange = iso >= lo && iso <= hi;

  return {
    isStart: iso === lo,
    isEnd: iso === hi,
    isInside: isInRange && iso !== lo && iso !== hi,
    isInRange,
    isPreview,
    isToday: today === iso,
    isDisabled,
  };
}

/**
 * The click rule.
 *
 * - Nothing picked, or a complete range already picked → start over from here.
 * - A start picked and this day is on or after it → close the range here.
 * - A start picked and this day is BEFORE it → start over from here, rather than
 *   silently swapping the ends. Swapping is the other common choice and it is
 *   worse: the user clicked a day meaning "the range begins here", and reading
 *   that as "the range now ends where it used to begin" is a different range
 *   from the one they asked for.
 */
export function nextSelection(current: RangeSelection, clicked: string): RangeSelection {
  if (!current.from || current.to) return { from: clicked, to: null };
  if (clicked < current.from) return { from: clicked, to: null };
  return { from: current.from, to: clicked };
}

/** A selection is usable once both ends exist and are the right way round. */
export function isCompleteRange(selection: RangeSelection): selection is { from: string; to: string } {
  return Boolean(selection.from && selection.to && selection.from <= selection.to);
}

/** Whole days in an inclusive range — the calendar's "14 days" readout. */
export function rangeLengthDays(from: string, to: string): number {
  const fromMs = parseIsoDay(from);
  const toMs = parseIsoDay(to);
  if (fromMs === null || toMs === null) return 0;
  return Math.floor((toMs - fromMs) / DAY_MS) + 1;
}

export type CalendarPreset = { label: string; from: string; to: string };

/**
 * The calendar's own shortcuts, which are calendar periods rather than the
 * picker's trailing-N-day presets.
 *
 * They exist because those are two different questions. "Past 30 days" is a
 * rolling window; "this month" is what a report is written against, and picking
 * month boundaries by hand every time is exactly the chore a custom range was
 * supposed to remove. Bounds are applied by the caller, which knows what data
 * it actually holds.
 */
export function calendarPresets(now: Date = new Date()): CalendarPreset[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = todayIso(now);

  const firstOf = (y: number, m: number) => toIsoDay(Date.UTC(y, m, 1));
  const lastOf = (y: number, m: number) => toIsoDay(Date.UTC(y, m + 1, 1) - DAY_MS);

  return [
    { label: "This month", from: firstOf(year, month), to: today },
    { label: "Last month", from: firstOf(year, month - 1), to: lastOf(year, month - 1) },
    { label: "This quarter", from: firstOf(year, Math.floor(month / 3) * 3), to: today },
  ];
}

/**
 * Clamps a preset to the selectable bounds, or drops it entirely when it falls
 * wholly outside them — a shortcut that produces an empty chart is worse than no
 * shortcut, because the user reads the emptiness as broken data rather than as a
 * range with nothing in it.
 */
export function clampPreset(
  preset: CalendarPreset,
  min?: string | null,
  max?: string | null,
): CalendarPreset | null {
  const from = min && preset.from < min ? min : preset.from;
  const to = max && preset.to > max ? max : preset.to;
  if (from > to) return null;
  if ((max && from > max) || (min && to < min)) return null;
  return { ...preset, from, to };
}
