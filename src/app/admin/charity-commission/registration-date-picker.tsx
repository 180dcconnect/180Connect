"use client";

import { useId, useMemo, useState } from "react";
import { Calendar, ChevronDown, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE } from "@/components/brand/motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRangeCalendar } from "@/components/ui/date-range-calendar";
import { type RangeSelection } from "@/lib/date-range";
import { cn } from "@/lib/utils";

const COLLAPSE_EASE = [0.8, 0, 0.3, 0.8] as const;

import {
  formatRegistrationDate,
  formatRegistrationRange,
  getRegistrationPresets,
  isValidIsoDate,
  type RegistrationPreset,
} from "./registration-date";

export {
  formatRegistrationDate,
  formatRegistrationRange,
  getRegistrationPresets,
  isValidIsoDate,
  type RegistrationPreset,
};

export type RegistrationDatePickerProps = {
  from: string | null;
  to: string | null;
  onChange: (range: { from: string | null; to: string | null }) => void;
  className?: string;
  disabled?: boolean;
};

/**
 * Custom date picker for Charity Commission registration filtering.
 * Replaces native `<input type="date">` with the app's own visual language:
 * - Formatted date readout trigger with clear button
 * - Radix Popover with DateRangeCalendar
 * - Quick presets for common charity registration search windows
 * - Direct ISO text inputs (type="text") for rapid typing or historic dates
 */
export function RegistrationDatePicker({
  from,
  to,
  onChange,
  className,
  disabled = false,
}: RegistrationDatePickerProps) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  // Draft state while popover is open
  const [draftFrom, setDraftFrom] = useState<string | null>(from);
  const [draftTo, setDraftTo] = useState<string | null>(to);

  // Text inputs for manual entry
  const [inputFrom, setInputFrom] = useState(from ?? "");
  const [inputTo, setInputTo] = useState(to ?? "");

  const fromInputId = useId();
  const toInputId = useId();

  // Keep draft in sync whenever popover opens or props change
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setDraftFrom(from);
      setDraftTo(to);
      setInputFrom(from ?? "");
      setInputTo(to ?? "");
    }
    setOpen(isOpen);
  };

  const presets = useMemo(() => getRegistrationPresets(), []);

  const hasSelection = Boolean(from || to);
  const triggerLabel = formatRegistrationRange(from, to);

  const handlePresetSelect = (preset: RegistrationPreset) => {
    setDraftFrom(preset.from);
    setDraftTo(preset.to);
    setInputFrom(preset.from ?? "");
    setInputTo(preset.to ?? "");
  };

  const handleCalendarSelect = (selection: RangeSelection) => {
    setDraftFrom(selection.from);
    setDraftTo(selection.to);
    setInputFrom(selection.from ?? "");
    setInputTo(selection.to ?? "");
  };

  const handleInputChange = (field: "from" | "to", rawValue: string) => {
    const value = rawValue.trim();
    if (field === "from") {
      setInputFrom(rawValue);
      if (value === "") {
        setDraftFrom(null);
      } else if (isValidIsoDate(value)) {
        setDraftFrom(value);
      }
    } else {
      setInputTo(rawValue);
      if (value === "") {
        setDraftTo(null);
      } else if (isValidIsoDate(value)) {
        setDraftTo(value);
      }
    }
  };

  const handleInputClear = (field: "from" | "to") => {
    if (field === "from") {
      setInputFrom("");
      setDraftFrom(null);
    } else {
      setInputTo("");
      setDraftTo(null);
    }
  };

  const handleApply = () => {
    let finalFrom = draftFrom;
    let finalTo = draftTo;

    // Normalise ordering if both are present
    if (finalFrom && finalTo && finalFrom > finalTo) {
      [finalFrom, finalTo] = [finalTo, finalFrom];
    }

    onChange({ from: finalFrom, to: finalTo });
    setOpen(false);
  };

  const handleReset = () => {
    setDraftFrom(null);
    setDraftTo(null);
    setInputFrom("");
    setInputTo("");
    onChange({ from: null, to: null });
    setOpen(false);
  };

  const handleTriggerClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftFrom(null);
    setDraftTo(null);
    setInputFrom("");
    setInputTo("");
    onChange({ from: null, to: null });
  };

  // Anchor calendar to the draft start month when changed via preset or manual input
  const calendarKey = draftFrom ? draftFrom.slice(0, 7) : "default";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "group flex h-9 min-w-[220px] items-center justify-between gap-2.5 rounded-lg border border-black/15 bg-white px-3 py-1.5 text-left text-sm transition-colors hover:border-black/30 dark:border-white/15 dark:bg-card dark:hover:border-white/30 focus-visible:outline-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50",
            hasSelection ? "text-foreground font-medium" : "text-foreground/60",
            className,
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <Calendar
              size={15}
              className={cn(
                "shrink-0 transition-colors",
                hasSelection ? "text-brand" : "text-foreground/45",
              )}
            />
            <span className="truncate">{triggerLabel}</span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {hasSelection && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear registration dates"
                onClick={handleTriggerClear}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleTriggerClear(e as unknown as React.MouseEvent);
                  }
                }}
                className="grid h-5 w-5 place-items-center rounded-md text-foreground/40 transition-colors hover:bg-black/[0.07] hover:text-foreground dark:hover:bg-white/[0.1]"
              >
                <X size={13} strokeWidth={2.5} />
              </span>
            )}
            <motion.div
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="text-foreground/40"
            >
              <ChevronDown size={14} strokeWidth={2.5} />
            </motion.div>
          </div>
        </button>
      </PopoverTrigger>

      <AnimatePresence>
        {open && (
          <PopoverContent
            forceMount
            align="start"
            sideOffset={6}
            className="w-[328px] overflow-visible border-none bg-transparent p-0 shadow-none outline-none focus:outline-none"
          >
            <motion.div
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, scale: 0.96, y: -8, filter: "blur(6px)" }
              }
              animate={
                reduceMotion
                  ? { opacity: 1, transition: { duration: 0.15 } }
                  : {
                      opacity: 1,
                      scale: 1,
                      y: 0,
                      filter: "blur(0px)",
                      transition: { duration: 0.24, ease: EASE },
                    }
              }
              exit={
                reduceMotion
                  ? { opacity: 0, transition: { duration: 0.1 } }
                  : {
                      opacity: 0,
                      scale: 0.96,
                      y: -6,
                      filter: "blur(4px)",
                      transition: { duration: 0.2, ease: COLLAPSE_EASE },
                    }
              }
              style={{
                transformOrigin: "var(--radix-popover-content-transform-origin, top)",
              }}
              className="w-[328px] rounded-xl border border-black/[0.08] bg-popover p-3.5 shadow-xl dark:border-white/[0.12]"
            >
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-black/[0.06] pb-2.5 dark:border-white/[0.08]">
                  <div>
                    <p className="text-xs font-bold text-foreground">Registration period</p>
                    <p className="text-[11px] text-foreground/50">
                      {formatRegistrationRange(draftFrom, draftTo)}
                    </p>
                  </div>
                  {(draftFrom || draftTo) && (
                    <button
                      type="button"
                      onClick={handleReset}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-foreground/50 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
                    >
                      <RotateCcw size={11} />
                      <span>Reset</span>
                    </button>
                  )}
                </div>

                {/* Presets */}
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-foreground/40">
                    Quick shortcuts
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {presets.map((preset) => {
                      const isActive =
                        draftFrom === preset.from && draftTo === preset.to;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => handlePresetSelect(preset)}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                            isActive
                              ? "bg-brand text-white font-semibold"
                              : "bg-black/[0.04] text-foreground/70 hover:bg-black/[0.08] hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.12]",
                          )}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setDraftFrom(null);
                        setDraftTo(null);
                        setInputFrom("");
                        setInputTo("");
                      }}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                        !draftFrom && !draftTo
                          ? "bg-brand text-white font-semibold"
                          : "bg-black/[0.04] text-foreground/70 hover:bg-black/[0.08] hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.12]",
                      )}
                    >
                      All time
                    </button>
                  </div>
                </div>

                {/* Manual Text Inputs (From / To) */}
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-black/[0.02] p-2 dark:bg-white/[0.03]">
                  <div>
                    <label
                      htmlFor={fromInputId}
                      className="mb-1 block text-[10px] font-bold uppercase tracking-[0.06em] text-foreground/50"
                    >
                      From
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id={fromInputId}
                        type="text"
                        placeholder="YYYY-MM-DD"
                        value={inputFrom}
                        onChange={(e) => handleInputChange("from", e.target.value)}
                        className="w-full rounded-md border border-black/15 bg-white px-2 py-1 text-[12px] font-mono text-foreground placeholder:text-foreground/30 focus:border-brand focus:outline-none dark:border-white/15 dark:bg-card"
                      />
                      {inputFrom && (
                        <button
                          type="button"
                          aria-label="Clear start date"
                          onClick={() => handleInputClear("from")}
                          className="absolute right-1.5 text-foreground/35 hover:text-foreground"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor={toInputId}
                      className="mb-1 block text-[10px] font-bold uppercase tracking-[0.06em] text-foreground/50"
                    >
                      To
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id={toInputId}
                        type="text"
                        placeholder="YYYY-MM-DD"
                        value={inputTo}
                        onChange={(e) => handleInputChange("to", e.target.value)}
                        className="w-full rounded-md border border-black/15 bg-white px-2 py-1 text-[12px] font-mono text-foreground placeholder:text-foreground/30 focus:border-brand focus:outline-none dark:border-white/15 dark:bg-card"
                      />
                      {inputTo && (
                        <button
                          type="button"
                          aria-label="Clear end date"
                          onClick={() => handleInputClear("to")}
                          className="absolute right-1.5 text-foreground/35 hover:text-foreground"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Visual Date Range Calendar */}
                <div className="border-t border-black/[0.06] pt-2 dark:border-white/[0.08]">
                  <DateRangeCalendar
                    key={calendarKey}
                    value={{ from: draftFrom, to: draftTo }}
                    onChange={handleCalendarSelect}
                    showPresets={false}
                  />
                </div>

                {/* Footer actions */}
                <div className="flex items-center justify-end gap-2 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-foreground/60 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    className="rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    Apply dates
                  </button>
                </div>
              </div>
            </motion.div>
          </PopoverContent>
        )}
      </AnimatePresence>
    </Popover>
  );
}
