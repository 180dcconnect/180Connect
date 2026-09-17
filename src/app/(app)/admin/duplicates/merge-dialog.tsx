"use client";

import { useEffect, useState } from "react";

import { discrepancyFieldLabel } from "@/lib/discrepancies";
import type { MergePreviewRow } from "@/lib/discrepancies/detect-field-discrepancies";
import type { PendingReview } from "@/lib/duplicates";
import { InlineAlert } from "@/components/ui/inline-alert";
import { reportError } from "@/lib/error-logging";

/**
 * F042's merge step — the dialog behind "Same charity, keep one record".
 *
 * Confirming used to keep the existing client byte-for-byte and push every
 * disagreement to the Data discrepancies queue for a second visit. Now the
 * confirmation itself asks: for each detail the two copies disagree on, which
 * copy wins? Every choice starts on what's already on the client record, so
 * saving without touching anything keeps everything — the dialog is the
 * confirmation, not an extra chore.
 *
 * The rows come from the preview endpoint, which runs the same comparison the
 * save path runs, so the dialog can never offer a different list from the one
 * that gets applied. A preview that fails still allows saving: the decision
 * goes through and the disagreements fall back to the discrepancies queue.
 */

export type FieldWinners = Record<string, "existing" | "incoming">;

/** Button shapes copied from the queue's own buttons, so the dialog reads as one screen. */
const PRIMARY_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const GHOST_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-transparent px-3 py-1.5 text-[13px] font-medium text-dim transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

/** Which register the incoming copy came from, in the words of the job. */
const SOURCE_NAME: Record<string, string> = {
  charity_commission: "Charity Commission",
  charity_commission_bulk: "Charity Commission",
  companies_house: "Companies House",
  find_that_charity: "Find That Charity",
};

function sourceName(source: string): string {
  return SOURCE_NAME[source] ?? "the register";
}

function WinnerOption({
  name,
  checked,
  disabled,
  caption,
  value,
  hint,
  onPick,
}: {
  name: string;
  checked: boolean;
  disabled: boolean;
  caption: string;
  value: string;
  hint?: string;
  onPick: () => void;
}) {
  return (
    <label
      className={`block cursor-pointer rounded-inset border px-3 py-2.5 transition-colors has-checked:border-lead has-checked:bg-lead-wash has-focus-visible:ring-2 has-focus-visible:ring-lead/30 ${
        checked ? "border-lead bg-lead-wash" : "border-rule bg-white hover:border-lead/40"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <span className="flex items-start gap-2.5">
        <input
          type="radio"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={onPick}
          className="mt-1 size-3.5 shrink-0 accent-lead"
        />
        <span className="min-w-0">
          <span className="block font-body text-[13px] font-medium text-ink">{caption}</span>
          <span className="mt-0.5 block font-body text-[13.5px] leading-[1.5] break-words text-ink">
            {value}
          </span>
          {hint && (
            <span className="mt-1 block font-body text-[12px] leading-[1.5] text-dim">{hint}</span>
          )}
        </span>
      </span>
    </label>
  );
}

export function MergeDialog({
  flag,
  saving,
  saveError,
  onCancel,
  onSave,
}: {
  flag: PendingReview;
  /** True while the parent is saving, so both buttons lock. */
  saving: boolean;
  /** The save's failure text, shown inside the dialog so the picks survive a retry. */
  saveError: string | null;
  onCancel: () => void;
  /**
   * Winners for every disagreeing row, including the ones left on the client
   * record — plus whether a comparison actually happened. When the preview
   * failed there is nothing to choose from, and the caller must not claim both
   * copies agreed.
   */
  onSave: (winners: FieldWinners, compared: boolean) => void;
}) {
  const [rows, setRows] = useState<MergePreviewRow[] | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [winners, setWinners] = useState<FieldWinners>({});

  const candidateId = flag.row.id;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(
          `/api/admin/duplicates/preview?candidateId=${encodeURIComponent(candidateId)}`,
        );
        if (!response.ok) {
          if (!cancelled) setPreviewFailed(true);
          return;
        }
        const body = await response.json();
        if (!cancelled) setRows(body.conflicts as MergePreviewRow[]);
      } catch (err) {
        void reportError(err, { operation: "admin.duplicates.preview_client" });
        if (!cancelled) setPreviewFailed(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  // Escape closes, except mid-save — the decision is already underway then.
  useEffect(() => {
    if (saving) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving, onCancel]);

  const loading = rows === null && !previewFailed;
  const disagreements = rows ?? [];
  const headingId = `merge-${candidateId}-heading`;

  function save() {
    onSave(
      Object.fromEntries(
        disagreements.map((row) => [row.fieldName, winners[row.fieldName] ?? "existing"]),
      ),
      !previewFailed,
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-5"
      onClick={saving ? undefined : onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-panel border border-rule bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]"
      >
        <div className="border-b border-rule-soft px-5 py-4">
          <h2
            id={headingId}
            className="font-body text-[16px] leading-[1.35] font-semibold tracking-[-0.01em] text-ink"
          >
            Same charity — pick the winning details
          </h2>
          <p className="mt-1 font-body text-[13px] leading-[1.6] text-dim">
            {flag.name} stays as one client. For each detail the two copies disagree on, choose
            which copy to keep — anything left alone stays exactly as it is, and every pick is
            recorded in the client&apos;s change history.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {saveError && <InlineAlert tone="error" message={saveError} />}

          {loading && (
            <p className="font-body text-sm leading-[1.65] text-dim">
              Comparing the two copies…
            </p>
          )}

          {!loading && previewFailed && (
            <InlineAlert
              tone="warning"
              message="The two copies could not be compared line by line. You can still keep one record — anything they disagree on will be flagged under Data discrepancies instead."
            />
          )}

          {!loading && !previewFailed && disagreements.length === 0 && (
            <p className="font-body text-sm leading-[1.65] text-dim">
              Both copies already agree on every detail — keeping one record changes nothing
              about the client.
            </p>
          )}

          {disagreements.map((row) => {
            const pick = winners[row.fieldName] ?? "existing";
            const optionName = `winner-${candidateId}-${row.fieldName}`;
            return (
              <fieldset key={row.fieldName}>
                <legend className="font-body text-[13px] font-semibold text-ink">
                  {discrepancyFieldLabel(row.fieldName)}
                </legend>
                {row.suggested === "incoming" && (
                  <p className="mt-0.5 font-body text-[12px] leading-[1.5] text-dim">
                    Heads up: the register&apos;s copy would normally win this one.
                  </p>
                )}
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  <WinnerOption
                    name={optionName}
                    checked={pick === "existing"}
                    disabled={saving}
                    caption="Keep the client record"
                    value={row.existingValue}
                    onPick={() =>
                      setWinners((current) => ({ ...current, [row.fieldName]: "existing" }))
                    }
                  />
                  <WinnerOption
                    name={optionName}
                    checked={pick === "incoming"}
                    disabled={saving}
                    caption={`Take from ${sourceName(row.incomingSource)}`}
                    value={row.incomingValue}
                    onPick={() =>
                      setWinners((current) => ({ ...current, [row.fieldName]: "incoming" }))
                    }
                  />
                </div>
              </fieldset>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule-soft px-5 py-3.5">
          <button type="button" className={GHOST_BUTTON} disabled={saving} onClick={onCancel}>
            Back
          </button>
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={saving || loading}
            onClick={save}
          >
            {saving
              ? "Keeping…"
              : previewFailed || disagreements.length === 0
                ? "Keep one record"
                : "Keep one record with these details"}
          </button>
        </div>
      </div>
    </div>
  );
}
