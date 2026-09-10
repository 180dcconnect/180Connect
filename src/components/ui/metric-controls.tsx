"use client";

import { useState } from "react";
import { Activity, BarChart3, CalendarRange, Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "@/components/brand/motion";
import { isCompleteRange, type RangeSelection } from "@/lib/date-range";
import { DateRangeCalendar } from "./date-range-calendar";
import type { ChartView } from "./metric-chart";

/**
 * A selectable window over the series. Two mutually exclusive shapes:
 * - `points`: how many trailing points to keep; omit for "everything" (presets).
 * - `from`/`to`: inclusive ISO days (YYYY-MM-DD) to filter the series by
 *   (custom ranges). When `from`/`to` are present they win over `points`.
 */
export type PeriodOption = { label: string; points?: number; from?: string; to?: string };

/**
 * The custom-range editor's own width, fixed on purpose.
 *
 * The popover shrink-wraps its content (`w-max`), so when the editor opens it is
 * the editor that decides how wide the popover becomes. Animating `width: 0 →
 * "auto"` needs "auto" to resolve to a stable number, and the calendar's cells
 * are `w-full` — their natural width is whatever the parent gives them, which is
 * circular. Pinning the editor breaks the circle.
 *
 * 16.5rem puts each of the seven day columns at ~35px, which is the smallest
 * that keeps a two-digit date comfortably inside its tap target.
 */
const RANGE_EDITOR_WIDTH = "16.5rem";

/* ─── Popover motion — the four numbers worth tuning ───────────────────────
 *
 * Everything about how the custom-range editor opens and closes is these
 * constants. Change them here; nothing downstream hardcodes a duration.
 *
 * OPENING and CLOSING are deliberately NOT symmetrical, which is the whole
 * reason the close needed its own pair of values:
 *
 *   EASE (opening) is [0.2, 0.7, 0.2, 1] — front-loaded, so the box is already
 *   most of the way open in the first third of the animation. That is exactly
 *   what you want on a press: the UI answers instantly, then settles.
 *
 *   Run that same curve backwards to close and it lurches away from the finger
 *   and then crawls the last 20% — which is what read as "not smooth". So the
 *   close uses COLLAPSE_EASE, the mathematical mirror of EASE (mirroring a
 *   cubic-bezier x1,y1,x2,y2 is 1-x2, 1-y2, 1-x1, 1-y1). It starts gently,
 *   accelerates, and is gone — an ease-IN to EASE's ease-OUT.
 *
 * HOW TO TUNE, in the order worth trying:
 *
 *   1. Close still too quick? Raise COLLAPSE_DURATION. 0.52 now; 0.6–0.7 is
 *      luxurious, past ~0.8 it reads as broken rather than smooth.
 *   2. Close feels sluggish to *start*? Drop the first number of COLLAPSE_EASE
 *      (0.8 → 0.5). Lower = leaves rest sooner. Raise it for more hang.
 *   3. Want open and close to match exactly? Set COLLAPSE to `EXPAND`. Do it to
 *      feel the difference before deciding — it is the version that felt wrong.
 *   4. The two FADE numbers control the calendar inside the box, not the box
 *      itself. Opening delays the fade so the calendar arrives once there is
 *      room; closing leads with it so the box is empty before it narrows. If you
 *      can see the calendar squashing as it closes, LOWER FADE_OUT so it is gone
 *      sooner. Keep it under COLLAPSE_DURATION or the fade outlives the box.
 *
 * ONE THING THE ANIMATION CANNOT FIX: pressing "Apply range" or "Reset" closes
 * the whole popover (`setOpen(false)`) in the same tick, so the width collapse
 * is never seen on that path — the popover has already unmounted. The collapse
 * plays when you toggle "Custom range" shut, or press Escape. If you want it on
 * apply too, that is a change in the onApply handler (drop its `setOpen(false)`
 * and let the editor collapse first), not here.
 */

/** Shared with the public search bar, so the two expansions read as one gesture. */
const EXPAND_DURATION = 0.42;
/** Longer than the open: a close has no press to justify being abrupt. */
const COLLAPSE_DURATION = 0.52;
/** The mirror of EASE — gentle out of rest, accelerating away. */
const COLLAPSE_EASE = [0.8, 0, 0.3, 0.8] as const;
/** The calendar fades in behind the box, and out ahead of it. */
const FADE_IN = { duration: 0.28, delay: 0.08 } as const;
const FADE_OUT = { duration: 0.3 } as const;

/**
 * The popover shell itself (the whole dropdown fading/scaling in and out), as
 * distinct from the editor widening inside it. This is the one that plays when
 * you press Apply, Reset or Escape. It was 0.15s easeOut both ways, which is
 * right on the way in and abrupt on the way out — hence the separate exit.
 */
const POPOVER_IN = { duration: 0.16, ease: EASE } as const;
const POPOVER_OUT = { duration: 0.26, ease: COLLAPSE_EASE } as const;

const EXPAND = { duration: EXPAND_DURATION, ease: EASE } as const;
const COLLAPSE = { duration: COLLAPSE_DURATION, ease: COLLAPSE_EASE } as const;

/** "12 Aug – 25 Aug", appending the year whenever either end isn't this year. */
function formatRangeLabel(from: string, to: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const yearFmt = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" });
  const currentYear = String(new Date().getUTCFullYear());
  const fromYear = yearFmt.format(new Date(`${from}T00:00:00Z`));
  const toYear = yearFmt.format(new Date(`${to}T00:00:00Z`));
  const fromLabel =
    fmt.format(new Date(`${from}T00:00:00Z`)) + (fromYear === currentYear ? "" : ` ${fromYear}`);
  const toLabel =
    fmt.format(new Date(`${to}T00:00:00Z`)) + (toYear === currentYear ? "" : ` ${toYear}`);
  return `${fromLabel} – ${toLabel}`;
}

/*
 * The custom-range editor lives inside the same glass popover as the presets,
 * so choosing a bespoke window never leaves the control the user already
 * learned — the dropdown just grows a second step.
 */
function CustomRangeEditor({
  initial,
  canReset,
  min,
  max,
  onApply,
  onReset,
}: {
  initial: { from: string; to: string } | null;
  /** Whether a custom range is currently active and can be reset. */
  canReset: boolean;
  /** Inclusive selectable bounds — usually the extent of the loaded series. */
  min?: string | null;
  max?: string | null;
  onApply: (from: string, to: string) => void;
  onReset: () => void;
}) {
  const [selection, setSelection] = useState<RangeSelection>(() => ({
    from: initial?.from ?? null,
    to: initial?.to ?? null,
  }));

  const valid = isCompleteRange(selection);

  return (
    <form
      className="mt-1 space-y-2 rounded-xl bg-black/[0.03] p-2 dark:bg-white/[0.05]"
      style={{ width: RANGE_EDITOR_WIDTH }}
      onSubmit={(event) => {
        event.preventDefault();
        if (isCompleteRange(selection)) onApply(selection.from, selection.to);
      }}
    >
      <DateRangeCalendar value={selection} onChange={setSelection} min={min} max={max} />

      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={!valid}
          className="flex-1 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Apply range
        </button>
        {canReset && (
          <button
            type="button"
            aria-label="Reset to default period"
            onClick={onReset}
            className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:bg-white/[0.08]"
          >
            Reset
          </button>
        )}
      </div>
    </form>
  );
}

/*
 * Both controls live inside ProgressMetricCard's `pointer-events-none` content
 * layer (which lets the chart underneath take the hover), so each interactive
 * element opts back in with `pointer-events-auto`.
 */

export function ViewToggle({
  value,
  onChange,
}: {
  value: ChartView;
  onChange: (view: ChartView) => void;
}) {
  const item = (view: ChartView, Icon: typeof Activity, label: string) => {
    const isSelected = value === view;
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={isSelected}
        onClick={() => onChange(view)}
        className={`relative pointer-events-auto z-10 rounded-full p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          isSelected
            ? "text-foreground font-semibold"
            : "text-foreground/40 hover:text-foreground/75"
        }`}
      >
        {isSelected && (
          <motion.div
            layoutId="view-toggle-pill"
            className="absolute inset-0 rounded-full bg-white dark:bg-card shadow-sm"
            transition={{ type: "spring", stiffness: 450, damping: 30 }}
          />
        )}
        <span className="relative z-10 block">
          <Icon size={14} strokeWidth={2.5} />
        </span>
      </button>
    );
  };

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] p-0.5 backdrop-blur-sm">
      {item("curve", Activity, "Line view")}
      {item("bars", BarChart3, "Bar view")}
    </div>
  );
}

export function PeriodSelect({
  value,
  options,
  onChange,
  accentText,
  allowCustomRange = false,
  defaultOption,
  rangeMin,
  rangeMax,
}: {
  value: string;
  options: PeriodOption[];
  onChange: (option: PeriodOption) => void;
  accentText: string;
  /** Adds a "Custom range…" step to the dropdown for picking exact dates. */
  allowCustomRange?: boolean;
  /** Where "Reset" sends the selection back to (usually the card's default). */
  defaultOption?: PeriodOption;
  /**
   * Inclusive ISO-day bounds the calendar may select within — normally the first
   * and last day the series actually holds.
   *
   * Worth passing wherever it is known. Without them a user can pick a window
   * the data does not cover and get an empty chart, which reads as "the
   * dashboard is broken" rather than "there is nothing in that window"; with
   * them, those days are visibly unavailable before the click.
   */
  rangeMin?: string | null;
  rangeMax?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [appliedCustom, setAppliedCustom] = useState<{ label: string; from: string; to: string } | null>(
    null,
  );
  const isCustomSelected = appliedCustom !== null && value === appliedCustom.label;

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/[0.03] dark:bg-white/[0.05] px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-all hover:bg-black/[0.06] dark:hover:bg-white/[0.09] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span>{value}</span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={14} strokeWidth={2.5} />
        </motion.div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4, transition: POPOVER_OUT }}
            transition={POPOVER_IN}
            /*
             * `w-max` is what makes the widening animate at all. The popover used
             * to be `min-w-[10.5rem]` with an auto width, so opening the custom
             * range snapped the box to its new width in a single frame while the
             * editor's height eased in underneath — the height was smooth and the
             * width was not, which is the jump this fixes.
             *
             * Shrink-wrapped instead, the popover's width is whatever its widest
             * child currently measures, so it follows the editor's own animated
             * width frame by frame and no width has to be hardcoded here. The
             * max-width is the viewport guard: the popover is anchored `right-0`
             * and grows leftwards, and this keeps it on screen on a narrow phone.
             */
            className="pointer-events-auto absolute right-0 top-full z-40 mt-1.5 w-max min-w-[10.5rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-popover/95 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.15)] backdrop-blur-md"
          >
            {options.map((option) => {
              const isSelected = option.label === value;
              return (
                <li key={option.label}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(option);
                      setCustomOpen(false);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                      isSelected
                        ? "bg-black/[0.05] dark:bg-white/[0.08]"
                        : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                    }`}
                    style={isSelected ? { color: accentText } : undefined}
                  >
                    <span>{option.label}</span>
                    {isSelected && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 25 }}
                      >
                        <Check size={14} strokeWidth={3} />
                      </motion.span>
                    )}
                  </button>
                </li>
              );
            })}

            {allowCustomRange && (
              <>
                <li
                  aria-hidden="true"
                  className="mx-2 my-1 border-t border-black/[0.06] dark:border-white/[0.08]"
                />
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isCustomSelected}
                    onClick={() => setCustomOpen((previous) => !previous)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                      isCustomSelected
                        ? "bg-black/[0.05] dark:bg-white/[0.08]"
                        : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                    }`}
                    style={isCustomSelected ? { color: accentText } : undefined}
                  >
                    <span>{appliedCustom?.label ?? "Custom range"}</span>
                    <motion.span
                      initial={false}
                      animate={{ rotate: customOpen ? 90 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="shrink-0"
                    >
                      {isCustomSelected ? (
                        <Check size={14} strokeWidth={3} />
                      ) : (
                        <CalendarRange size={14} strokeWidth={2.5} />
                      )}
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {customOpen && (
                      <motion.div
                        /*
                         * Width AND height, on the one curve. Animating only the
                         * height left the popover's width to snap; growing the
                         * editor's own width from 0 makes the shrink-wrapped
                         * popover above widen with it, so the whole box opens as
                         * a single motion. Opacity trails slightly behind the box
                         * (see the per-key timings) so the fields fade in once
                         * there is room for them rather than reflowing in view.
                         */
                        initial={{ opacity: 0, width: 0, height: 0 }}
                        animate={{ opacity: 1, width: RANGE_EDITOR_WIDTH, height: "auto" }}
                        /*
                         * Closing gets its own, slower curve — see COLLAPSE at the
                         * top of the file for why it is not just EXPAND reversed.
                         * The opening fade delay must not apply here, or the fields
                         * would still be on screen while the box narrows past them.
                         */
                        exit={{
                          opacity: 0,
                          width: 0,
                          height: 0,
                          transition: {
                            width: COLLAPSE,
                            height: COLLAPSE,
                            opacity: { ...FADE_OUT, ease: COLLAPSE_EASE },
                          },
                        }}
                        transition={{
                          width: EXPAND,
                          height: EXPAND,
                          opacity: { ...FADE_IN, ease: EASE },
                        }}
                        className="overflow-hidden"
                      >
                        <CustomRangeEditor
                          initial={appliedCustom}
                          canReset={isCustomSelected}
                          min={rangeMin}
                          max={rangeMax}
                          onReset={() => {
                            setAppliedCustom(null);
                            setCustomOpen(false);
                            setOpen(false);
                            if (defaultOption) onChange(defaultOption);
                          }}
                          onApply={(from, to) => {
                            const label = formatRangeLabel(from, to);
                            setAppliedCustom({ label, from, to });
                            onChange({ label, from, to });
                            setCustomOpen(false);
                            setOpen(false);
                          }}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              </>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
