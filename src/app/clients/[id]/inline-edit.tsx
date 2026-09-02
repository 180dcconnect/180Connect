"use client";

import { useId } from "react";
import { Check, Undo2, X } from "lucide-react";

import {
  REASON_MAX_LENGTH,
  fieldWarnings,
  inputTypeFor,
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
  error,
}: {
  fieldName: string;
  label: string;
  value: string;
  currentValue: string | null;
  onChange: (next: string) => void;
  onCancel: () => void;
  error?: string;
}) {
  const inputId = useId();
  const max = maxLengthFor(fieldName);
  const multiline = isLongFormField(fieldName);
  const warnings = fieldWarnings(fieldName, value);
  const note = normalisationNote(fieldName, value);
  const unchanged = value.trim().length > 0 && value.trim() === (currentValue ?? "").trim();
  // Only worth saying near the ceiling. A live count on a 500-character field
  // you have typed nine characters into is noise.
  const showCount = value.length > max - 40;

  const shared = {
    id: inputId,
    value,
    maxLength: max,
    "aria-label": `${label}, new value`,
    "aria-invalid": Boolean(error) || undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
    onKeyDown: (event: React.KeyboardEvent) => {
      // Escape abandons this row's edit without touching the others.
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
    className: `w-full rounded-inset border bg-white px-3 py-1.5 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-lead-mid focus-visible:ring-2 focus-visible:ring-lead-mid/40 ${
      error ? "border-stop/60" : "border-rule"
    }`,
  } as const;

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="flex items-start gap-1.5">
        {multiline ? (
          <textarea {...shared} rows={3} className={`${shared.className} resize-y`} />
        ) : (
          <input {...shared} type={inputTypeFor(fieldName)} autoComplete="off" />
        )}
        <button
          type="button"
          onClick={onCancel}
          aria-label={`Stop editing ${label.toLowerCase()}`}
          className="mt-0.5 shrink-0 rounded-inset p-1.5 text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      {(error || note || unchanged || showCount || warnings.length > 0) && (
        <div className="flex flex-col gap-0.5 text-[12px] leading-[1.45]">
          {error && (
            <p className="font-semibold text-stop" role="alert">
              {error}
            </p>
          )}
          {unchanged && (
            <p className="text-faint">Same as the value on record — nothing to submit.</p>
          )}
          {note && <p className="text-dim">{note}</p>}
          {warnings.map((warning) => (
            <p key={warning} className="text-hold">
              {warning}
            </p>
          ))}
          {showCount && (
            <p className={value.length >= max ? "font-semibold text-stop" : "text-faint"}>
              {value.length} / {max} characters
            </p>
          )}
        </div>
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
    <div className="mt-4 rounded-inset border border-rule bg-paper px-3.5 py-3">
      <p className="text-[13px] font-semibold text-ink">
        {count === 1 ? "1 change" : `${count} changes`}{" "}
        <span className="font-normal text-dim">
          {isCam ? "ready to propose" : "ready to save"}
        </span>
      </p>

      {isCam && (
        <div className="mt-2.5">
          <label className="text-[12px] font-medium text-dim" htmlFor={reasonId}>
            Why is this right? <span className="font-normal text-faint">(optional)</span>
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
          className="inline-flex items-center gap-1.5 rounded-inset bg-lead px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-lead/90 focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none disabled:opacity-60"
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
          className="inline-flex items-center gap-1.5 rounded-inset border border-rule bg-white px-3 py-1.5 text-[13px] font-semibold text-dim transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none disabled:opacity-60"
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
  return state.results.filter((result) => result.ok).map((result) => result.fieldName);
}

export { restrictedFieldLabel };
