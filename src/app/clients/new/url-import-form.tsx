"use client";

import { useActionState } from "react";

import { importFromUrl, type UrlImportState } from "./import-actions";

const initialState: UrlImportState = { kind: "idle", message: "" };

/**
 * The F037 entry point, above the manual form rather than beside it.
 *
 * Both routes end at the same place — a MANUAL_ENTRY_RECORDS draft the CAM reviews —
 * so this is one page with a shortcut at the top, not two competing flows. A CAM who
 * pastes a URL and gets nothing usable can carry straight on into the form below with
 * the failure explained above it, which is the F256 fallback without a detour.
 */
export function UrlImportForm() {
  const [state, action, pending] = useActionState(importFromUrl, initialState);

  const tone = state.kind === "error"
    ? "bg-red-50 text-red-900"
    : state.kind === "idle"
      ? ""
      : "bg-amber-50 text-amber-900";

  return (
    <section className="mt-6 rounded-xl border border-black/10 bg-gray-50 p-4">
      <h2 className="text-sm font-bold">Start from their website</h2>
      <p className="mt-1 text-sm text-foreground/65">
        Paste an organisation&apos;s website address and we will read what it says about
        itself, then confirm the details against Companies House and the Charity
        Commission where it gives a registration number. Nothing is saved until you
        review it.
      </p>

      <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 text-sm font-bold">
          Website address
          <input
            className="mt-1 w-full rounded-lg border border-black/20 px-3 py-2"
            defaultValue={state.sourceUrl ?? ""}
            inputMode="url"
            maxLength={2000}
            name="sourceUrl"
            placeholder="https://example.org"
            required
            type="text"
          />
        </label>
        <button
          className="rounded-lg bg-brand px-4 py-2 font-bold text-white disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending ? "Reading…" : "Import from website"}
        </button>
      </form>

      {state.message && (
        <div className={`mt-3 rounded-lg p-3 text-sm ${tone}`} role="alert">
          <p>{state.message}</p>
          {state.notes && state.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {state.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
