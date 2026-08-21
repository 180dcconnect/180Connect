"use client";

import { useState } from "react";
import { Activity, BarChart3, Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ChartView } from "./metric-chart";

/**
 * A selectable window over the series. `points` is how many trailing points to
 * keep; omit it to mean "everything".
 */
export type PeriodOption = { label: string; points?: number };

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
}: {
  value: string;
  options: PeriodOption[];
  onChange: (option: PeriodOption) => void;
  accentText: string;
}) {
  const [open, setOpen] = useState(false);

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
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
