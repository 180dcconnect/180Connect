"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE } from "@/components/brand/motion";
import { cn } from "@/lib/utils";

const COLLAPSE_EASE = [0.8, 0, 0.3, 0.8] as const;
import {
  MONTH_NAMES,
  WEEKDAY_LABELS,
  addMonths,
  buildMonthGrid,
  calendarPresets,
  clampDayToMonth,
  clampPreset,
  dayFlags,
  monthKeyOf,
  monthLabel,
  nextSelection,
  rangeLengthDays,
  todayIso,
  type MonthKey,
  type RangeSelection,
} from "@/lib/date-range";

/**
 * A range calendar, in the app's own visual language rather than the operating
 * system's — the replacement for the two `<input type="date">` fields the metric
 * period picker used to offer. The rules it obeys (grid shape, click behaviour,
 * preview, bounds) all live in @/lib/date-range.ts; this file is only the paint
 * and the keyboard.
 *
 * WHAT IT FIXES, beyond looking like the rest of the app:
 * - One control for one intention. A range was previously two independent single
 *   date fields; the user now expresses "these dates" in two clicks on one
 *   surface, and sees the span highlighted as they go.
 * - It cannot dismiss its own parent. The native picker is browser chrome, so
 *   focus leaving into it read as focus leaving the popover, which closes on
 *   blur. Every element here is a real DOM node inside that subtree.
 * - Days with no data are visibly unavailable. `min`/`max` grey them out, which
 *   the native input could only express by silently refusing the click.
 * - en-GB, Monday-first, always — not whatever the machine's locale says, which
 *   is how the field could read 09/12/2026 under a label reading "12 Sept".
 *
 * Keyboard: arrows move by a day, PageUp/PageDown by a month, Home/End to the
 * ends of the week, Enter or Space picks. Focus is a single tab stop with a
 * roving `tabIndex`, so a keyboard user does not tab through 42 cells.
 */

/**
 * Cells fill their grid column rather than carrying a fixed width. That is what
 * lets the range track join up: a fixed-width cell inside a wider column leaves
 * a gap between days, and the "one continuous bar" the selection is drawn as
 * would come out as a row of separate blocks.
 */
const CELL = "h-[30px] w-full";

export type DateRangeCalendarProps = {
  /** Committed selection; drives what is drawn, and where the calendar opens. */
  value: RangeSelection;
  onChange: (selection: RangeSelection) => void;
  /** Inclusive bounds — days outside are shown but not selectable. */
  min?: string | null;
  max?: string | null;
  /** Injected in tests / stories; defaults to the real clock. */
  now?: Date;
  /** Hides the This month / Last month / This quarter row. */
  showPresets?: boolean;
  className?: string;
};

export function DateRangeCalendar({
  value,
  onChange,
  min,
  max,
  now,
  showPresets = true,
  className = "",
}: DateRangeCalendarProps) {
  const reduceMotion = useReducedMotion();
  const today = useMemo(() => todayIso(now ?? new Date()), [now]);

  // Open on the month holding the current start, else on the newest month the
  // bounds allow, else today's — so a bounded calendar never opens on a page of
  // greyed-out days.
  const [month, setMonth] = useState<MonthKey>(() => {
    const anchor = value.from ?? (max && max < today ? max : today);
    return monthKeyOf(anchor);
  });
  const [hover, setHover] = useState<string | null>(null);
  const [focusedDay, setFocusedDay] = useState<string>(() => value.from ?? today);
  const gridRef = useRef<HTMLDivElement>(null);

  const [activeDropdown, setActiveDropdown] = useState<"month" | "year" | null>(null);
  const [yearSearch, setYearSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const activeYearRef = useRef<HTMLButtonElement>(null);

  const currentYear = Number(month.slice(0, 4));
  const currentMonthIndex = Number(month.slice(5, 7)) - 1;
  const currentMonthName = MONTH_NAMES[currentMonthIndex] ?? "Month";

  const minYear = min ? Number(min.slice(0, 4)) : 1940;
  const maxYear = max ? Number(max.slice(0, 4)) : new Date().getUTCFullYear() + 5;

  const allYears = useMemo(() => {
    const years: number[] = [];
    for (let y = maxYear; y >= minYear; y -= 1) {
      years.push(y);
    }
    return years;
  }, [minYear, maxYear]);

  const filteredYears = useMemo(() => {
    if (!yearSearch.trim()) return allYears;
    const query = yearSearch.trim();
    return allYears.filter((y) => String(y).includes(query));
  }, [allYears, yearSearch]);

  useEffect(() => {
    if (activeDropdown === "year") {
      requestAnimationFrame(() => {
        yearInputRef.current?.focus();
        yearInputRef.current?.select();
        activeYearRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
      });
    }
  }, [activeDropdown]);

  useEffect(() => {
    if (!activeDropdown) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        setActiveDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeDropdown]);

  const handleSelectMonth = (monthIndex: number) => {
    const newMonthStr = String(monthIndex + 1).padStart(2, "0");
    const newMonthKey = `${currentYear}-${newMonthStr}`;
    setMonth(newMonthKey);
    setFocusedDay((prev) => clampDayToMonth(prev, newMonthKey));
    setActiveDropdown(null);
  };

  const handleSelectYear = (year: number) => {
    const newMonthKey = `${year}-${String(currentMonthIndex + 1).padStart(2, "0")}`;
    setMonth(newMonthKey);
    setFocusedDay((prev) => clampDayToMonth(prev, newMonthKey));
    setActiveDropdown(null);
  };

  const handleYearSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const num = Number(yearSearch.trim());
    if (!Number.isNaN(num) && num >= minYear && num <= maxYear) {
      handleSelectYear(num);
    } else if (filteredYears.length > 0) {
      handleSelectYear(filteredYears[0]);
    }
  };

  /**
   * Split into weeks so the grid can carry real `role="row"` elements. The ARIA
   * grid pattern wants grid → row → gridcell, and skipping the row level is what
   * makes a hand-rolled calendar unreadable to a screen reader even when it looks
   * right.
   */
  const weeks = useMemo(() => {
    const cells = buildMonthGrid(month);
    const rows: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [month]);
  const presets = useMemo(() => {
    if (!showPresets) return [];
    return calendarPresets(now ?? new Date())
      .map((preset) => clampPreset(preset, min, max))
      .filter((preset): preset is NonNullable<typeof preset> => preset !== null);
  }, [showPresets, now, min, max]);

  // Paging is disabled at the edges rather than allowed and then empty: the
  // whole month is out of bounds, so there is nothing to show there.
  const previousMonth = addMonths(month, -1);
  const nextMonth = addMonths(month, 1);
  const canGoBack = !min || `${previousMonth}-31` >= min;
  const canGoForward = !max || `${nextMonth}-01` <= max;

  const selectDay = (iso: string) => {
    onChange(nextSelection(value, iso));
    setFocusedDay(iso);
  };

  /** Moves focus by whole days, paging the visible month when it crosses out. */
  const moveFocus = (deltaDays: number, deltaMonths = 0) => {
    let target = focusedDay;
    if (deltaMonths !== 0) {
      const shifted = addMonths(monthKeyOf(focusedDay), deltaMonths);
      // Clamp the day so 31 March − 1 month is 28/29 Feb, not an invalid date.
      const day = Number(focusedDay.slice(8, 10));
      const lastOfShifted = new Date(
        Date.UTC(Number(shifted.slice(0, 4)), Number(shifted.slice(5, 7)), 0),
      ).getUTCDate();
      target = `${shifted}-${String(Math.min(day, lastOfShifted)).padStart(2, "0")}`;
    }
    if (deltaDays !== 0) {
      const ms = Date.parse(`${target}T00:00:00Z`) + deltaDays * 24 * 60 * 60 * 1000;
      target = new Date(ms).toISOString().slice(0, 10);
    }
    if (min && target < min) target = min;
    if (max && target > max) target = max;

    setFocusedDay(target);
    if (monthKeyOf(target) !== month) setMonth(monthKeyOf(target));
    // The DOM node may not exist yet on a month change; the effect-free way to
    // handle that is to let the roving tabIndex put focus there on render.
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${target}"]`)?.focus();
    });
  };

  const onGridKeyDown = (event: React.KeyboardEvent) => {
    const keyed: Record<string, () => void> = {
      ArrowLeft: () => moveFocus(-1),
      ArrowRight: () => moveFocus(1),
      ArrowUp: () => moveFocus(-7),
      ArrowDown: () => moveFocus(7),
      PageUp: () => moveFocus(0, -1),
      PageDown: () => moveFocus(0, 1),
      Home: () => moveFocus(-((new Date(`${focusedDay}T00:00:00Z`).getUTCDay() + 6) % 7)),
      End: () => moveFocus(6 - ((new Date(`${focusedDay}T00:00:00Z`).getUTCDay() + 6) % 7)),
    };
    const handler = keyed[event.key];
    if (handler) {
      event.preventDefault();
      // Stop Escape-style bubbling to the parent popover for navigation keys
      // only; Escape itself is deliberately left to close the popover.
      event.stopPropagation();
      handler();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (!(min && focusedDay < min) && !(max && focusedDay > max)) selectDay(focusedDay);
    }
  };

  const readout = (() => {
    if (!value.from) return "Pick a start date";
    if (!value.to) return "Now pick an end date";
    const days = rangeLengthDays(value.from, value.to);
    return `${days} day${days === 1 ? "" : "s"} selected`;
  })();

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onMouseLeave={() => setHover(null)}
    >
      {/* Month & Year header */}
      <div className="flex items-center justify-between gap-1 px-0.5">
        <button
          type="button"
          aria-label={`Previous month, ${monthLabel(previousMonth)}`}
          disabled={!canGoBack}
          onClick={() => {
            setMonth(previousMonth);
            setActiveDropdown(null);
          }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-foreground/50 transition-colors hover:bg-black/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand dark:hover:bg-white/[0.08]"
        >
          <ChevronLeft size={16} strokeWidth={2.5} />
        </button>

        {/* Center: Interactive Month & Year Buttons with enlarged text */}
        <div className="flex items-center gap-1">
          {/* Month Dropdown Button */}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={activeDropdown === "month"}
            aria-label={`Select month, currently ${currentMonthName}`}
            onClick={() => setActiveDropdown((curr) => (curr === "month" ? null : "month"))}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[14px] font-bold tracking-tight transition-colors focus-visible:outline-2 focus-visible:outline-brand cursor-pointer",
              activeDropdown === "month"
                ? "bg-brand/15 text-foreground"
                : "text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
            )}
          >
            <span>{currentMonthName}</span>
            <ChevronDown
              size={13}
              strokeWidth={2.5}
              className={cn(
                "opacity-45 transition-transform duration-200",
                activeDropdown === "month" && "rotate-180 opacity-100"
              )}
            />
          </button>

          {/* Year Dropdown Button */}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={activeDropdown === "year"}
            aria-label={`Select year, currently ${currentYear}`}
            onClick={() => {
              setYearSearch("");
              setActiveDropdown((curr) => (curr === "year" ? null : "year"));
            }}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2 py-1 text-[14px] font-bold tracking-tight tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-brand cursor-pointer",
              activeDropdown === "year"
                ? "bg-brand/15 text-foreground"
                : "text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
            )}
          >
            <span>{currentYear}</span>
            <ChevronDown
              size={13}
              strokeWidth={2.5}
              className={cn(
                "opacity-45 transition-transform duration-200",
                activeDropdown === "year" && "rotate-180 opacity-100"
              )}
            />
          </button>
        </div>

        <button
          type="button"
          aria-label={`Next month, ${monthLabel(nextMonth)}`}
          disabled={!canGoForward}
          onClick={() => {
            setMonth(nextMonth);
            setActiveDropdown(null);
          }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-foreground/50 transition-colors hover:bg-black/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand dark:hover:bg-white/[0.08]"
        >
          <ChevronRight size={16} strokeWidth={2.5} />
        </button>
      </div>

      {/* Month & Year Dropdown Panels */}
      <AnimatePresence>
        {activeDropdown === "month" && (
          <motion.div
            initial={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96, y: -6, filter: "blur(4px)" }
            }
            animate={
              reduceMotion
                ? { opacity: 1, transition: { duration: 0.15 } }
                : {
                    opacity: 1,
                    scale: 1,
                    y: 0,
                    filter: "blur(0px)",
                    transition: { duration: 0.22, ease: EASE },
                  }
            }
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0.1 } }
                : {
                    opacity: 0,
                    scale: 0.96,
                    y: -4,
                    filter: "blur(3px)",
                    transition: { duration: 0.18, ease: COLLAPSE_EASE },
                  }
            }
            className="absolute left-1/2 top-9 z-30 w-[270px] -translate-x-1/2 rounded-xl border border-black/[0.08] bg-popover p-2.5 shadow-xl backdrop-blur-md dark:border-white/[0.12]"
          >
            <div className="mb-2 flex items-center justify-between border-b border-black/[0.06] pb-1.5 dark:border-white/[0.08]">
              <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/50">
                Select month ({currentYear})
              </span>
              <button
                type="button"
                aria-label="Close month dropdown"
                onClick={() => setActiveDropdown(null)}
                className="grid h-5 w-5 place-items-center rounded text-foreground/40 hover:text-foreground"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1">
              {MONTH_NAMES.map((name, index) => {
                const isSelected = index === currentMonthIndex;
                const mKey = `${currentYear}-${String(index + 1).padStart(2, "0")}`;
                const isDisabled = Boolean(
                  (min && `${mKey}-31` < min) || (max && `${mKey}-01` > max)
                );
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleSelectMonth(index)}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors text-left",
                      isSelected
                        ? "bg-brand text-white font-bold"
                        : "text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.08]",
                      isDisabled && "opacity-25 pointer-events-none"
                    )}
                  >
                    <span>{name}</span>
                    {isSelected && <Check size={12} strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {activeDropdown === "year" && (
          <motion.div
            initial={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96, y: -6, filter: "blur(4px)" }
            }
            animate={
              reduceMotion
                ? { opacity: 1, transition: { duration: 0.15 } }
                : {
                    opacity: 1,
                    scale: 1,
                    y: 0,
                    filter: "blur(0px)",
                    transition: { duration: 0.22, ease: EASE },
                  }
            }
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0.1 } }
                : {
                    opacity: 0,
                    scale: 0.96,
                    y: -4,
                    filter: "blur(3px)",
                    transition: { duration: 0.18, ease: COLLAPSE_EASE },
                  }
            }
            className="absolute left-1/2 top-9 z-30 w-[270px] -translate-x-1/2 rounded-xl border border-black/[0.08] bg-popover p-2.5 shadow-xl backdrop-blur-md dark:border-white/[0.12]"
          >
            <div className="mb-2 flex items-center justify-between border-b border-black/[0.06] pb-1.5 dark:border-white/[0.08]">
              <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/50">
                Select or type year
              </span>
              <button
                type="button"
                aria-label="Close year dropdown"
                onClick={() => setActiveDropdown(null)}
                className="grid h-5 w-5 place-items-center rounded text-foreground/40 hover:text-foreground"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>

            {/* Direct Type Input */}
            <form onSubmit={handleYearSearchSubmit} className="mb-2 flex items-center gap-1.5">
              <div className="relative flex-1">
                <input
                  ref={yearInputRef}
                  type="text"
                  inputMode="numeric"
                  placeholder="Type year (e.g. 2021)…"
                  value={yearSearch}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                    setYearSearch(cleaned);
                  }}
                  className="w-full rounded-md border border-black/15 bg-white px-2.5 py-1 text-xs font-mono text-foreground placeholder:text-foreground/35 focus:border-brand focus:outline-none dark:border-white/15 dark:bg-card"
                />
                {yearSearch && (
                  <button
                    type="button"
                    onClick={() => setYearSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!yearSearch.trim()}
                className="rounded-md bg-brand px-2.5 py-1 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Jump
              </button>
            </form>

            {/* Scrollable Year Grid */}
            <div className="grid max-h-44 grid-cols-3 gap-1 overflow-y-auto pr-1">
              {filteredYears.map((y) => {
                const isSelected = y === currentYear;
                return (
                  <button
                    key={y}
                    ref={isSelected ? activeYearRef : undefined}
                    type="button"
                    onClick={() => handleSelectYear(y)}
                    className={cn(
                      "rounded-md py-1.5 text-center font-mono text-xs transition-colors",
                      isSelected
                        ? "bg-brand font-bold text-white"
                        : "text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                    )}
                  >
                    {y}
                  </button>
                );
              })}
              {filteredYears.length === 0 && (
                <p className="col-span-3 py-3 text-center text-xs text-foreground/45">
                  No matching year
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-2 grid grid-cols-7 gap-y-0.5">
        {WEEKDAY_LABELS.map((label, index) => (
          <span
            key={`${label}-${index}`}
            aria-hidden="true"
            className={`${CELL} grid place-items-center text-[10px] font-bold uppercase tracking-[0.06em] text-foreground/30`}
          >
            {label}
          </span>
        ))}
      </div>

      {/*
        role="grid" with a roving tabIndex: one tab stop for the whole calendar,
        arrows to move inside it. Tabbing through 42 buttons is the accessibility
        failure mode of hand-rolled calendars, and the reason the native input is
        tempting in the first place.
      */}
      <div
        ref={gridRef}
        role="grid"
        aria-label={`${monthLabel(month)}. Use the arrow keys to move by day, Page Up and Page Down by month.`}
        onKeyDown={onGridKeyDown}
      >
        <motion.div
          key={month}
          role="rowgroup"
          initial={reduceMotion ? false : { opacity: 0.5, filter: "blur(2px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.16, ease: EASE }}
        >
          {weeks.map((week) => (
            <div key={week[0].iso} role="row" className="grid grid-cols-7 gap-y-0.5">
              {week.map((cell) => {
                const flags = dayFlags(cell.iso, {
                  selection: value,
                  hover,
                  min,
                  max,
                  today,
                });

                // The range track is a background behind the day: full-width on the
                // days inside the span, half-width under each end — so consecutive
                // cells join into one continuous bar while the two caps keep their
                // own rounded pill. A preview draws the same bar, lighter.
                const trackTint = flags.isPreview ? "bg-brand/[0.10]" : "bg-brand/[0.16]";
                const isCap = flags.isStart || flags.isEnd;
                const spansOneDay = flags.isStart && flags.isEnd;

                return (
                  // `aria-selected` belongs on the gridcell, not the button — the
                  // button role does not support it, and the ARIA grid pattern puts
                  // selection state on the cell.
                  <div
                    key={cell.iso}
                    role="gridcell"
                    aria-selected={isCap}
                    className="relative"
                  >
                    {flags.isInside && (
                      <span aria-hidden="true" className={`absolute inset-0 ${trackTint}`} />
                    )}
                    {flags.isStart && !spansOneDay && (
                      <span
                        aria-hidden="true"
                        className={`absolute inset-y-0 right-0 w-1/2 ${trackTint}`}
                      />
                    )}
                    {flags.isEnd && !spansOneDay && (
                      <span
                        aria-hidden="true"
                        className={`absolute inset-y-0 left-0 w-1/2 ${trackTint}`}
                      />
                    )}

                    <button
                      type="button"
                      data-day={cell.iso}
                      tabIndex={cell.iso === focusedDay ? 0 : -1}
                      disabled={flags.isDisabled}
                      aria-current={flags.isToday ? "date" : undefined}
                      aria-label={new Date(`${cell.iso}T00:00:00Z`).toLocaleDateString("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                      onMouseEnter={() => setHover(cell.iso)}
                      onFocus={() => setHover(cell.iso)}
                      onClick={() => selectDay(cell.iso)}
                      className={[
                        CELL,
                        "relative z-10 grid place-items-center rounded-lg text-[12px] tabular-nums transition-colors",
                        "focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-brand",
                        flags.isDisabled
                          ? "cursor-not-allowed text-foreground/20"
                          : "hover:bg-black/[0.06] dark:hover:bg-white/[0.10]",
                        isCap
                          ? "bg-brand font-bold text-white hover:bg-brand"
                          : cell.inMonth
                            ? "font-medium text-foreground"
                            : "font-medium text-foreground/30",
                        flags.isToday && !isCap ? "ring-1 ring-inset ring-brand/45" : "",
                      ].join(" ")}
                    >
                      {cell.dayOfMonth}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </motion.div>
      </div>

      <p className="mt-2 text-center text-[11px] font-medium text-foreground/45" aria-live="polite">
        {readout}
      </p>

      {presets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-black/[0.06] pt-2 dark:border-white/[0.08]">
          {presets.map((preset) => {
            const isActive = value.from === preset.from && value.to === preset.to;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  onChange({ from: preset.from, to: preset.to });
                  setMonth(monthKeyOf(preset.from));
                  setFocusedDay(preset.from);
                }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${
                  isActive
                    ? "bg-brand/15 text-foreground"
                    : "bg-black/[0.04] text-foreground/55 hover:bg-black/[0.07] hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.10]"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default DateRangeCalendar;
