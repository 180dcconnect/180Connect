"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { CARD, CARD_HINT, CARD_TITLE } from "./styles";

/**
 * A pick-one setting as a card: a real radio group, not buttons wearing
 * `role="radio"`.
 *
 * The earlier settings forms gave each option `role="radio"` with no
 * surrounding `radiogroup`, no shared name and no arrow-key movement. Native
 * radios in a `fieldset` get grouping, the legend as the group's name, arrow
 * keys and a single tab stop from the browser for free.
 *
 * Shared by Accessibility and Notifications.
 */
export function OptionGroup<T extends string>({
  name,
  title,
  hint,
  options,
  labels,
  descriptions,
  value,
  onChange,
  columns,
  sample,
}: {
  name: string;
  title: string;
  hint: ReactNode;
  options: readonly T[];
  labels: Record<T, string>;
  descriptions: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
  columns: "sm:grid-cols-2" | "sm:grid-cols-3";
  /** Optional visual sample shown above an option's label. */
  sample?: (option: T) => ReactNode;
}) {
  return (
    <section className={CARD}>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className={`p-0 ${CARD_TITLE}`}>{title}</legend>
        <p id={`${name}-hint`} className={CARD_HINT}>
          {hint}
        </p>

        <div
          className={`mt-4 grid grid-cols-1 gap-3 border-t border-rule-soft pt-4 ${columns}`}
        >
          {options.map((option) => {
            const active = value === option;
            return (
              <label
                key={option}
                className="relative flex cursor-pointer flex-col items-start rounded-inset border border-rule bg-white px-4 py-3.5 transition-colors hover:bg-paper/60 has-checked:border-lead has-checked:bg-lead-wash/50 has-focus-visible:ring-2 has-focus-visible:ring-lead/30"
              >
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={active}
                  onChange={() => onChange(option)}
                  aria-describedby={`${name}-hint`}
                  className="sr-only"
                />
                <span className="flex w-full items-center justify-between gap-3">
                  {sample ? (
                    sample(option)
                  ) : (
                    <span className="text-sm font-semibold text-ink">{labels[option]}</span>
                  )}
                  <span
                    aria-hidden="true"
                    className={`flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      active ? "border-lead bg-lead text-white" : "border-rule bg-white"
                    }`}
                  >
                    {active && <Check className="size-2.5" strokeWidth={3} />}
                  </span>
                </span>
                {sample && (
                  <span className="mt-2.5 text-sm font-semibold text-ink">{labels[option]}</span>
                )}
                <span className="mt-1 text-[13px] leading-[1.55] text-dim">
                  {descriptions[option]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
