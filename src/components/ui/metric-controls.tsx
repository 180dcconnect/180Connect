"use client";

import { useState } from "react";
import { Activity, BarChart3, Check, ChevronDown } from "lucide-react";
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
  const item = (view: ChartView, Icon: typeof Activity, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={value === view}
      onClick={() => onChange(view)}
      className={`pointer-events-auto rounded-full p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        value === view
          ? "bg-white text-foreground shadow-sm"
          : "text-foreground/40 hover:text-foreground/70"
      }`}
    >
      <Icon size={14} strokeWidth={2.5} />
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-black/[0.05] p-0.5">
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
        className="pointer-events-auto flex items-center gap-1 rounded-full px-2 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {value}
        <ChevronDown size={14} strokeWidth={2.5} className={open ? "rotate-180" : undefined} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="pointer-events-auto absolute right-0 top-full z-30 mt-1 min-w-[10rem] overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-[0_8px_24px_rgba(0,0,0,0.10)]"
        >
          {options.map((option) => (
            <li key={option.label}>
              <button
                type="button"
                role="option"
                aria-selected={option.label === value}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-accent"
                style={option.label === value ? { color: accentText } : undefined}
              >
                {option.label}
                {option.label === value && <Check size={14} strokeWidth={3} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
