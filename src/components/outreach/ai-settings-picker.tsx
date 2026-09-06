"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { Check, ChevronLeft } from "lucide-react";
import { useState } from "react";
import { EASE, stagger } from "@/components/brand/motion";

/**
 * The Stage 1 email's five dials, as a drill-down list rather than a stack of
 * native `<select>`s. This is the compose modal's AI picker card
 * (src/components/inbox/gmail-compose-modal.tsx) lifted verbatim — same
 * container, same two pages, same motion, same chips — so the settings read
 * identically whether the CAM starts from the inbox or from the client record.
 *
 * The parent still owns the five values and their setters. It hands them in as
 * `settings` — one entry per dial with its options, current value and the
 * setter to call — the same shape the modal builds for its own drill pages.
 */
export type AiSettingEntry = {
  key: string;
  /** Row label on the list, and the header on the options page. */
  label: string;
  /** Optional one-liner shown under the options list. */
  hint?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
};

const AI_PANEL_STAGGER = stagger(0.05, 0.14);
const AI_OPTION_LIST: Variants = { hidden: {}, show: {} };

/** Motion inside the picker is opacity + y only — the same rule the modal's
    picker obeys, so a `filter` never lands inside a backdrop-filter subtree. */
const AI_ROW: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

const aiRowIndexed = (step = 0.025, cap = 0.3): Variants => ({
  hidden: { opacity: 0, y: 8 },
  show: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: EASE, delay: Math.min(index * step, cap) },
  }),
});

const AI_OPTION_ROWS = aiRowIndexed(0.025, 0.3);

/** Level one: the list of settings. A row carries a lime chip so the current
    value shows without opening it. */
function AiCategoryPage({
  rows,
  onOpen,
  hasFooter,
}: {
  rows: Array<{ key: string; label: string; chip?: string }>;
  onOpen: (key: string) => void;
  hasFooter: boolean;
}) {
  return (
    <motion.ul
      variants={AI_PANEL_STAGGER}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className={`absolute inset-0 flex h-full flex-col gap-1 overflow-y-auto px-4 pt-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${hasFooter ? "pb-16" : "pb-3"}`}
    >
      {rows.map((row) => (
        <motion.li key={row.key} variants={AI_ROW}>
          <button
            type="button"
            onClick={() => onOpen(row.key)}
            className="font-body flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-lg font-medium text-slate-900 transition-colors hover:bg-slate-900/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600"
          >
            <span className="truncate">{row.label}</span>
            {row.chip && (
              <span className="max-w-[45%] shrink-0 truncate rounded-full bg-lime-100 px-2 py-0.5 text-xs font-bold text-ink">
                {row.chip}
              </span>
            )}
          </button>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/** Level two: one setting's options — a back button and the setting's name on
    top, options below. Selecting fills the choice and Back returns to the list. */
function AiOptionPage({
  title,
  hint,
  options,
  selected,
  onSelect,
  onBack,
}: {
  title: string;
  hint?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
  onBack: () => void;
}) {
  return (
    <motion.div
      variants={AI_PANEL_STAGGER}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="absolute inset-0 flex h-full flex-col pt-3"
    >
      <motion.div variants={AI_ROW} className="flex shrink-0 items-center gap-2 px-4 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="font-body flex shrink-0 cursor-pointer items-center gap-1 rounded-2xl px-3 py-2 text-[15px] font-medium text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <span className="font-body min-w-0 flex-1 truncate px-1 text-[15px] font-medium text-slate-500">
          {title}
        </span>
      </motion.div>

      <motion.ul
        variants={AI_OPTION_LIST}
        className="flex-1 flex flex-col gap-1 overflow-y-auto px-4 pb-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {options.map((option, index) => {
          const isSelected = option.value === selected;
          return (
            <motion.li key={option.value} variants={AI_OPTION_ROWS} custom={index}>
              <button
                type="button"
                onClick={() => onSelect(option.value)}
                aria-pressed={isSelected}
                className={`font-body flex w-full cursor-pointer items-center justify-between rounded-2xl px-3 py-2 text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600 ${
                  isSelected
                    ? "bg-lime-100 text-black"
                    : "text-slate-900 hover:bg-slate-900/5 hover:text-slate-900"
                }`}
              >
                <span>{option.label}</span>
                {isSelected && <Check className="h-4 w-4 text-lime-800" />}
              </button>
            </motion.li>
          );
        })}
        {hint && (
          <motion.li
            variants={AI_ROW}
            className="font-body px-3 pt-1 text-[15px] text-slate-500"
          >
            {hint}
          </motion.li>
        )}
      </motion.ul>
    </motion.div>
  );
}

export function AiSettingsPicker({
  settings,
  disabled = false,
  footer,
}: {
  settings: readonly AiSettingEntry[];
  disabled?: boolean;
  /**
   * Actions floating over the card's bottom edge, never in a bar of their own
   * beneath it — the compose modal's arrangement, where "Generate draft" sits
   * on the settings it reads rather than somewhere else on the page.
   *
   * The strip is `pointer-events-none` so the gap between the buttons stays
   * click-through to the list underneath; each button re-enables its own.
   */
  footer?: React.ReactNode;
}) {
  const [drillSetting, setDrillSetting] = useState<string | null>(null);
  const activeDrill = drillSetting
    ? (settings.find((setting) => setting.key === drillSetting) ?? null)
    : null;

  const categoryRows = settings.map((setting) => ({
    key: setting.key,
    label: setting.label,
    chip: setting.options.find((option) => option.value === setting.selected)?.label,
  }));

  return (
    <div
      aria-disabled={disabled || undefined}
      className={`relative mt-4 overflow-hidden rounded-2xl border border-slate-900/8 bg-slate-50/70 ${
        footer ? "h-[340px]" : "h-[286px]"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <AnimatePresence>
        {activeDrill ? (
          <AiOptionPage
            key={activeDrill.key}
            title={activeDrill.label}
            hint={activeDrill.hint}
            options={activeDrill.options}
            selected={activeDrill.selected}
            onSelect={(value) => {
              activeDrill.onSelect(value);
              setDrillSetting(null);
            }}
            onBack={() => setDrillSetting(null)}
          />
        ) : (
          <AiCategoryPage
            hasFooter={Boolean(footer)}
            key="ai-categories"
            onOpen={(key) => setDrillSetting(key)}
            rows={categoryRows}
          />
        )}
      </AnimatePresence>

      {footer && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex items-center justify-between">
          {footer}
        </div>
      )}
    </div>
  );
}
