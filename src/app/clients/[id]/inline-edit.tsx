"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, MapPin, Undo2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { GooeyTextInput } from "@/components/ui/gooey-text-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatUkCity,
  searchUkCities,
} from "@/lib/uk-cities";

import {
  REASON_MAX_LENGTH,
  fieldWarnings,
  isLongFormField,
  maxLengthFor,
  normalisationNote,
  restrictedFieldLabel,
  type EditBatchState,
} from "@/lib/edit-suggestions";

/**
 * The pieces of the in-place editor on "General Information".
 *
 * Correcting a field used to mean opening a dialog and picking the field out of
 * a select — which is asking the reader to re-state the thing they had just
 * pointed at. Worse, it was asymmetric with what the card already did: an empty
 * row offered an inline "Add" button, so *adding* a value happened on the row
 * and *correcting* one happened in a modal. Same act, two interactions.
 *
 * Now the row itself is the editor, and the dialog is gone. What that buys, past
 * the missing step: a correction to an address is line 1, town and postcode
 * edited together and submitted once, instead of three trips through a modal
 * producing three unrelated-looking decisions on an admin's desk.
 *
 * Three things live here that the dialog never had room for, all of them the
 * difference between an error caught now and an error caught by an admin who
 * cannot check it either:
 *
 * - **The cap is visible.** Every restricted column has a length limit the
 *   server enforces; the input stops at the same number and says so as it gets
 *   close, rather than rejecting a submission after the fact.
 * - **The value is normalised, out loud.** A bare domain gets a scheme, an email
 *   loses its `mailto:`, a postcode gets its canonical spacing — and the row
 *   says what it will be saved as. Silent rewriting is the version of this that
 *   erodes trust.
 * - **Format problems warn rather than block.** `website` and `contact_email`
 *   deliberately accept the messy shapes real registers publish, so a hard
 *   validator would refuse values the record is allowed to hold. A warning still
 *   catches the typo, and still lets the odd real value through.
 */

export function InlineFieldInput({
  fieldName,
  label,
  value,
  currentValue,
  onChange,
  onCancel,
  onSubmit,
  pending,
  error,
}: {
  fieldName: string;
  label: string;
  value: string;
  currentValue: string | null;
  onChange: (next: string) => void;
  onCancel: () => void;
  /** The droplet and the Enter key both send the whole batch, not this row. */
  onSubmit: () => void;
  pending: boolean;
  error?: string;
}) {
  const textareaId = useId();
  const max = maxLengthFor(fieldName);
  const multiline = isLongFormField(fieldName);
  const warnings = fieldWarnings(fieldName, value);
  const note = normalisationNote(fieldName, value);
  const unchanged =
    value.trim().length > 0 && value.trim() === (currentValue ?? "").trim();
  // Only worth saying near the ceiling. A live count on a 500-character field
  // you have typed nine characters into is noise.
  const showCount = value.length > max - 40;

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="flex items-start gap-1.5">
        {multiline ? (
          /* The liquid capsule is one line by construction — a mission
             statement is a paragraph, and shrinking one into a pill would be
             choosing the component over the content. */
          <textarea
            id={textareaId}
            value={value}
            rows={3}
            maxLength={max}
            aria-label={`${label}, new value`}
            aria-invalid={Boolean(error) || undefined}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
            className={`w-full resize-y rounded-inset border bg-white px-3 py-1.5 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-lead-mid focus-visible:ring-2 focus-visible:ring-lead-mid/40 ${
              error ? "border-stop/60" : "border-rule"
            }`}
          />
        ) : (
          <div className="min-w-0 flex-1">
            <GooeyTextInput
              name={`inline-${fieldName}`}
              defaultValue={value}
              label={label}
              size="sm"
              align="start"
              fluid
              maxLength={max}
              pending={pending}
              buttonIcon="check"
              onValueChange={onChange}
              onSubmit={onSubmit}
              onEscape={onCancel}
            />
          </div>
        )}
        <button
          type="button"
          onClick={onCancel}
          aria-label={`Stop editing ${label.toLowerCase()}`}
          className="mt-2 shrink-0 rounded-inset p-1.5 text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      {(error || note || unchanged || showCount || warnings.length > 0) && (
        <div className="-mt-1 flex flex-col gap-0.5 pl-1 text-[12px] leading-[1.45]">
          {error && (
            <p className="font-semibold text-stop" role="alert">
              {error}
            </p>
          )}
          {unchanged && (
            <p className="text-faint">
              Same as the value on record — nothing to submit.
            </p>
          )}
          {note && <p className="text-dim">{note}</p>}
          {warnings.map((warning) => (
            <p key={warning} className="text-hold">
              {warning}
            </p>
          ))}
          {showCount && (
            <p
              className={
                value.length >= max ? "font-semibold text-stop" : "text-faint"
              }
            >
              {value.length} / {max} characters
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The inline editor for UK town or city with autocomplete search.
 *
 * Offers instant matching across official UK cities and major towns with
 * regional context, full keyboard navigation (Up/Down/Enter/Escape), custom-typed
 * entry support, Title Case normalization, and batch submission.
 */
export function InlineCityInput({
  label = "Town or city",
  value,
  currentValue,
  onChange,
  onCancel,
  onSubmit,
  pending,
  error,
}: {
  label?: string;
  value: string;
  currentValue: string | null;
  onChange: (next: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  pending: boolean;
  error?: string;
}) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [prevValue, setPrevValue] = useState(value);
  const [search, setSearch] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);

  if (value !== prevValue) {
    setPrevValue(value);
    setSearch(value);
  }

  const max = maxLengthFor("city");
  const warnings = fieldWarnings("city", value);
  const note = normalisationNote("city", value);
  const unchanged =
    value.trim().length > 0 && value.trim() === (currentValue ?? "").trim();
  const showCount = value.length > max - 40;

  const suggestions = useMemo(() => searchUkCities(search, 8), [search]);
  const trimmedSearch = search.trim();
  const exactMatch = useMemo(
    () =>
      suggestions.some(
        (s) => s.name.toLowerCase() === trimmedSearch.toLowerCase(),
      ),
    [suggestions, trimmedSearch],
  );

  const canUseCustom = trimmedSearch.length > 0 && !exactMatch;
  const totalOptions = suggestions.length + (canUseCustom ? 1 : 0);
  const customOptionIndex = canUseCustom ? suggestions.length : -1;

  const clampedActiveIndex = Math.min(
    activeIndex,
    Math.max(0, totalOptions - 1),
  );

  useEffect(() => {
    if (!isOpen) return;
    const item = listRef.current?.querySelector('[data-active="true"]');
    item?.scrollIntoView({ block: "nearest" });
  }, [clampedActiveIndex, isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(cityName: string) {
    const formatted = formatUkCity(cityName);
    setSearch(formatted);
    onChange(formatted);
    setIsOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(0);
        return;
      }
      if (totalOptions > 0) {
        setActiveIndex((prev) => (prev + 1) % totalOptions);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(Math.max(0, totalOptions - 1));
        return;
      }
      if (totalOptions > 0) {
        setActiveIndex((prev) => (prev - 1 + totalOptions) % totalOptions);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (isOpen && totalOptions > 0) {
        if (clampedActiveIndex === customOptionIndex && canUseCustom) {
          handleSelect(trimmedSearch);
        } else if (suggestions[clampedActiveIndex]) {
          handleSelect(suggestions[clampedActiveIndex].name);
        }
      } else {
        onSubmit();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (isOpen) {
        setIsOpen(false);
      } else {
        onCancel();
      }
      return;
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex w-full min-w-0 flex-col gap-1 ${isOpen ? "z-40" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <div
          className={`flex min-w-0 flex-1 items-center rounded-inset border bg-white px-3 py-1.5 text-sm transition-all focus-within:border-lead focus-within:ring-2 focus-within:ring-lead/20 ${
            error ? "border-stop/60" : "border-rule"
          }`}
        >
          <MapPin
            aria-hidden="true"
            className="size-4 shrink-0 text-lead mr-2.5"
          />

          <input
            ref={inputRef}
            type="text"
            role="combobox"
            value={search}
            maxLength={max}
            disabled={pending}
            placeholder="Search UK city or town…"
            aria-label={`${label}, new value`}
            aria-expanded={isOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => {
              const next = e.target.value;
              setSearch(next);
              onChange(next);
              setIsOpen(true);
              setActiveIndex(0);
            }}
            onClick={() => {
              if (!isOpen) {
                setIsOpen(true);
                setActiveIndex(0);
              }
            }}
            onFocus={() => {
              setIsOpen(true);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          />

          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                onChange("");
                inputRef.current?.focus();
                setIsOpen(true);
              }}
              aria-label="Clear city input"
              className="shrink-0 rounded-full p-0.5 text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label={`Stop editing ${label.toLowerCase()}`}
          className="shrink-0 rounded-inset p-1.5 text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      {/* Autocomplete dropdown menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={listId}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 top-full z-50 mt-1.5 w-full max-w-sm rounded-panel border border-rule bg-white p-1 shadow-xl shadow-black/10"
          >
            <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-dim">
              <span>{trimmedSearch ? "UK towns & cities" : "Popular UK locations"}</span>
              <span className="text-[10px] font-normal text-faint">↑↓ to navigate · ↵ to select</span>
            </div>

            <div ref={listRef} className="max-h-52 overflow-y-auto py-0.5">
              {suggestions.map((city, index) => {
                const isActive = index === clampedActiveIndex;
                const isSelected =
                  value.trim().toLowerCase() === city.name.toLowerCase();

                return (
                  <button
                    key={`${city.name}-${city.region}`}
                    type="button"
                    data-active={isActive}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => handleSelect(city.name)}
                    className={`flex w-full items-center justify-between gap-2 rounded-inset px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                      isActive ? "bg-paper text-ink" : "text-ink hover:bg-paper/70"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-medium text-ink truncate">{city.name}</span>
                      <span className="text-[11px] text-faint truncate">
                        {city.region}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded bg-rule-soft/60 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-dim">
                        {city.type}
                      </span>
                      {isSelected && (
                        <Check aria-hidden="true" className="size-3.5 stroke-[2.5] text-lead" />
                      )}
                    </div>
                  </button>
                );
              })}

              {canUseCustom && (
                <div className={suggestions.length > 0 ? "mt-1 border-t border-rule-soft pt-1" : ""}>
                  <button
                    type="button"
                    data-active={clampedActiveIndex === customOptionIndex}
                    onMouseMove={() => setActiveIndex(customOptionIndex)}
                    onClick={() => handleSelect(trimmedSearch)}
                    className={`flex w-full items-center justify-between gap-2 rounded-inset px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                      clampedActiveIndex === customOptionIndex
                        ? "bg-paper text-ink"
                        : "text-ink hover:bg-paper/70"
                    }`}
                  >
                    <span className="text-dim">
                      Use custom: <span className="font-semibold text-ink">&ldquo;{formatUkCity(trimmedSearch)}&rdquo;</span>
                    </span>
                    <span className="text-[11px] text-faint">Enter</span>
                  </button>
                </div>
              )}

              {suggestions.length === 0 && !canUseCustom && (
                <p className="px-3 py-4 text-center text-[12px] text-faint">
                  No matching UK cities or towns found.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(error || note || unchanged || showCount || warnings.length > 0) && (
        <div className="-mt-0.5 flex flex-col gap-0.5 pl-1 text-[12px] leading-[1.45]">
          {error && (
            <p className="font-semibold text-stop" role="alert">
              {error}
            </p>
          )}
          {unchanged && (
            <p className="text-faint">
              Same as the value on record — nothing to submit.
            </p>
          )}
          {note && <p className="text-dim">{note}</p>}
          {warnings.map((warning) => (
            <p key={warning} className="text-hold">
              {warning}
            </p>
          ))}
          {showCount && (
            <p
              className={
                value.length >= max ? "font-semibold text-stop" : "text-faint"
              }
            >
              {value.length} / {max} characters
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The editor for a row backed by a Postgres enum — today only `organisation_type`.
 *
 * A pill you can type into is the wrong shape for a closed set: the column is
 * `public.organisation_type`, so anything outside the eight values comes back
 * from Postgres as `22P02 invalid input value for enum`, which the batch can
 * only report as "could not be saved". A select cannot express the invalid
 * value in the first place, and it also names the options — "CIO" and "CIC" are
 * not values anybody guesses from a blank input.
 *
 * There is no droplet: nothing is typed, so there is no keystroke to submit on.
 * Picking a value fills the draft and the card's own bar sends the batch, the
 * same as every other row.
 */
export function InlineEnumInput({
  label,
  value,
  options,
  onChange,
  onCancel,
  pending,
  error,
}: {
  label: string;
  value: string;
  /** Enum values in display order, each with the label the rest of the app uses. */
  options: readonly { value: string; label: string }[];
  onChange: (next: string) => void;
  onCancel: () => void;
  pending: boolean;
  error?: string;
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <Select value={value} onValueChange={onChange} disabled={pending}>
            <SelectTrigger
              aria-label={`${label}, new value`}
              aria-invalid={Boolean(error) || undefined}
              className="w-full"
            >
              <SelectValue placeholder={`Choose a ${label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label={`Stop editing ${label.toLowerCase()}`}
          className="shrink-0 rounded-inset p-1.5 text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      {error && (
        <p className="pl-1 text-[12px] font-semibold text-stop" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The submit bar. Appears only once something has actually been changed, so the
 * card is exactly as quiet as it was before while you are only reading it.
 */
export function EditDraftBar({
  count,
  isCam,
  reason,
  onReasonChange,
  onSubmit,
  onDiscard,
  pending,
  state,
}: {
  count: number;
  isCam: boolean;
  reason: string;
  onReasonChange: (next: string) => void;
  onSubmit: () => void;
  onDiscard: () => void;
  pending: boolean;
  state: EditBatchState;
}) {
  const reasonId = useId();
  const overLength = reason.trim().length > REASON_MAX_LENGTH;

  return (
    <div className="rounded-panel border border-lead/20 bg-paper/95 p-4 shadow-sm backdrop-blur-xs">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-lead/10 px-2.5 py-0.5 text-[12px] font-semibold text-lead">
          <motion.span
            key={count}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            {count === 1 ? "1 change" : `${count} changes`}
          </motion.span>
        </span>
        <span className="text-[13px] font-normal text-dim">
          {isCam ? "ready to propose" : "ready to save"}
        </span>
      </div>

      {isCam && (
        <div className="mt-3">
          <label
            className="text-[12px] font-medium text-dim"
            htmlFor={reasonId}
          >
            Why is this right?{" "}
            <span className="font-normal text-faint">(optional)</span>
          </label>
          {/* The admin deciding this sees two strings and a name. Without a line
              of provenance, "St Mary's Trust" → "St Marys Trust" is a correction
              or a typo with equal probability, and the decision is a guess. */}
          <textarea
            id={reasonId}
            value={reason}
            rows={2}
            maxLength={REASON_MAX_LENGTH}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="e.g. checked against the Charity Commission register today"
            className="mt-1 w-full resize-y rounded-inset border border-rule bg-white px-3 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-faint focus:border-lead-mid focus-visible:ring-2 focus-visible:ring-lead-mid/40"
          />
          {reason.trim().length > REASON_MAX_LENGTH - 60 && (
            <p
              className={`mt-0.5 text-[12px] ${overLength ? "font-semibold text-stop" : "text-faint"}`}
            >
              {reason.trim().length} / {REASON_MAX_LENGTH} characters
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || overLength}
          className="inline-flex items-center gap-1.5 rounded-inset bg-lead px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-lead/90 focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none disabled:opacity-60 cursor-pointer"
        >
          <Check aria-hidden="true" className="size-3.5" />
          {pending
            ? isCam
              ? "Sending…"
              : "Saving…"
            : isCam
              ? count === 1
                ? "Propose correction"
                : `Propose ${count} corrections`
              : count === 1
                ? "Save change"
                : `Save ${count} changes`}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-inset border border-rule bg-white px-3 py-1.5 text-[13px] font-semibold text-dim transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none disabled:opacity-60 cursor-pointer"
        >
          <Undo2 aria-hidden="true" className="size-3.5" />
          Discard
        </button>
        {isCam && (
          <p className="text-[12px] text-faint">
            The record stays as it is until an admin approves.
          </p>
        )}
      </div>

      {state.kind !== "idle" && state.message && (
        <p
          aria-live="polite"
          role={state.kind === "error" ? "alert" : undefined}
          className={`mt-2.5 text-[12.5px] font-semibold ${
            state.kind === "success"
              ? "text-go"
              : state.kind === "partial"
                ? "text-hold"
                : "text-stop"
          }`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

/** One field's failure, restated with its own name in front of it. */
export function fieldErrorsFrom(state: EditBatchState): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const result of state.results) {
    if (!result.ok) errors[result.fieldName] = result.message;
  }
  return errors;
}

/** Fields that landed, so their drafts can be cleared and the rest kept. */
export function succeededFields(state: EditBatchState): string[] {
  return state.results
    .filter((result) => result.ok)
    .map((result) => result.fieldName);
}

export { restrictedFieldLabel };
