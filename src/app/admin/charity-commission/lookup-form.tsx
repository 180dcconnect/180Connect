"use client";

import { useActionState } from "react";
import { lookupCharity, type CharityCommissionImportState } from "./actions";

const initialLookupState: CharityCommissionImportState = {
  kind: "idle",
  message: "",
};

const stateStyles = {
  success: "bg-green-50 text-green-900",
  warning: "bg-amber-50 text-amber-900",
  error: "bg-red-50 text-red-900",
} as const;

export function CharityCommissionLookupForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(lookupCharity, initialLookupState);

  return (
    <div className="mt-8 rounded-xl border border-black/10 p-5">
      <h2 className="text-lg font-bold">Look up a single charity</h2>
      <p className="mt-2 text-sm text-foreground/65">
        Enter a known Charity Commission registration number to fetch and
        import just that charity, without running a date-range backfill.
      </p>

      {!configured && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900" role="alert">
          Charity Commission API access is not configured. Add the server-side
          API key before running a lookup.
        </p>
      )}

      <form action={action} className="mt-5 space-y-4">
        <div>
          <label className="block text-sm font-bold" htmlFor="registeredNumber">
            Registration number
          </label>
          <input
            className="mt-1 w-full max-w-md rounded-lg border border-black/20 px-3 py-2 text-sm"
            disabled={!configured || pending}
            id="registeredNumber"
            name="registeredNumber"
            placeholder="For example, 1218781"
          />
        </div>
        <button
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!configured || pending}
          type="submit"
        >
          {pending ? "Looking up…" : "Look up charity"}
        </button>
      </form>

      {state.kind !== "idle" && (
        <div className={`mt-5 rounded-lg p-4 text-sm ${stateStyles[state.kind]}`} role={state.kind === "error" ? "alert" : "status"}>
          <p className="font-bold">{state.message}</p>
          {state.counts && (
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(state.counts).map(([label, value]) => (
                <div key={label}>
                  <dt className="capitalize opacity-70">{label}</dt>
                  <dd className="text-lg font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
