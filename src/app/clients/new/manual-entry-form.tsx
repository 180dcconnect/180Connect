"use client";

import { useActionState } from "react";
import { submitManualEntry, type ManualEntryState } from "./actions";

const initialState: ManualEntryState = { kind: "idle", message: "" };
const inputClass = "mt-1 w-full rounded-lg border border-black/20 px-3 py-2";

export function ManualEntryForm() {
  const [state, action, pending] = useActionState(submitManualEntry, initialState);
  return (
    <form action={action} className="mt-6 space-y-5">
      <label className="block text-sm font-bold">Organisation name
        <input className={inputClass} name="legalName" required maxLength={200} />
      </label>
      <label className="block text-sm font-bold">Country code
        <input className={inputClass} name="countryCode" defaultValue="GB" required maxLength={2} pattern="[A-Za-z]{2}" />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-bold">Website <span className="font-normal text-foreground/60">(optional)</span>
          <input className={inputClass} name="website" placeholder="https://example.org" maxLength={500} />
        </label>
        <label className="block text-sm font-bold">Contact email <span className="font-normal text-foreground/60">(optional)</span>
          <input className={inputClass} name="contactEmail" type="text" maxLength={320} />
        </label>
        <label className="block text-sm font-bold">Registry name <span className="font-normal text-foreground/60">(optional)</span>
          <input className={inputClass} name="registryName" maxLength={200} />
        </label>
        <label className="block text-sm font-bold">Registry number <span className="font-normal text-foreground/60">(optional)</span>
          <input className={inputClass} name="registryNumber" maxLength={200} />
        </label>
      </div>
      <label className="block text-sm font-bold">Why is manual entry needed?
        <textarea className={inputClass} name="reason" required minLength={10} maxLength={2000} rows={4} />
      </label>
      {state.message && <p className={`rounded-lg p-3 text-sm ${state.kind === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`} role="status">{state.message}</p>}
      {state.warnings && state.warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <p className="font-bold">Saved with field warnings</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {state.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}
      <button className="rounded-lg bg-brand px-4 py-2 font-bold text-white disabled:opacity-50" disabled={pending} type="submit">
        {pending ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
