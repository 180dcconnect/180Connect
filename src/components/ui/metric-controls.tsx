"use client";

import { useState } from "react";
import { Activity, BarChart3, CalendarRange, Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ChartView } from "./metric-chart";

/**
 * A selectable window over the series. Two mutually exclusive shapes:
 * - `points`: how many trailing points to keep; omit for "everything" (presets).
 * - `from`/`to`: inclusive ISO days (YYYY-MM-DD) to filter the series by
 *   (custom ranges). When `from`/`to` are present they win over `points`.
 */
export type PeriodOption = { label: string; points?: number; from?: string; to?: string };

const RANGE_INPUT =
  "w-full rounded-lg border border-black/[0.06] dark:border-white/[0.10] bg-black/[0.03] dark:bg-white/[0.05] px-2 py-1.5 text-[12px] font-medium text-foreground outline-none transition-colors focus-visible:border-brand focus-visible:outline-none [color-scheme:light] dark:[color-scheme:dark]";

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
  onApply,
  onReset,
}: {
  initial: { from: string; to: string } | null;
  /** Whether a custom range is currently active and can be reset. */
  canReset: boolean;
  onApply: (from: string, to: string) => void;
  onReset: () => void;
}) {
  const [from, setFrom] = useState(initial?.from ?? "");
  const [to, setTo] = useState(initial?.to ?? "");

  // ISO days compare correctly as plain strings.
  const valid = from !== "" && to !== "" && from <= to;

  return (
    <form
      className="mt-1 space-y-2 rounded-xl bg-black/[0.03] p-2 dark:bg-white/[0.05]"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onApply(from, to);
      }}
    >
      <div className="flex items-center gap-2">
        <input
          aria-label="From date"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => setFrom(event.target.value)}
          className={RANGE_INPUT}
        />
        <span className="text-[11px] font-medium text-muted-foreground">to</span>
        <input
          aria-label="To date"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => setTo(event.target.value)}
          className={RANGE_INPUT}
        />
      </div>
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
}: {
  value: string;
  options: PeriodOption[];
  onChange: (option: PeriodOption) => void;
  accentText: string;
  /** Adds a "Custom range…" step to the dropdown for picking exact dates. */
  allowCustomRange?: boolean;
  /** Where "Reset" sends the selection back to (usually the card's default). */
  defaultOption?: PeriodOption;
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
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="pointer-events-auto absolute right-0 top-full z-40 mt-1.5 min-w-[10.5rem] overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-popover/95 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.15)] backdrop-blur-md"
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
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="overflow-hidden"
                      >
                        <CustomRangeEditor
                          initial={appliedCustom}
                          canReset={isCustomSelected}
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
