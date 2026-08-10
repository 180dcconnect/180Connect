"use client";

import { useActionState } from "react";
import { lookupThreeSixtyGivingGrants, type ThreeSixtyGivingImportState } from "./actions";

const initialLookupState: ThreeSixtyGivingImportState = {
  kind: "idle",
  message: "",
};

const stateStyles = {
  success: "bg-green-50 text-green-900",
  warning: "bg-amber-50 text-amber-900",
  error: "bg-red-50 text-red-900",
} as const;

export function ThreeSixtyGivingLookupForm() {
  const [state, action, pending] = useActionState(lookupThreeSixtyGivingGrants, initialLookupState);

  return (
    <div className="mt-8 rounded-xl border border-black/10 p-5">
      <h2 className="text-lg font-bold">Look up one charity or company</h2>
      <p className="mt-2 text-sm text-foreground/65">
        Enter a known Charity Commission registration number or Companies
        House company number to fetch just that organisation&apos;s grants,
        without walking the whole pipeline.
      </p>

      <form action={action} className="mt-5 space-y-4">
        <div>
          <label className="block text-sm font-bold" htmlFor="charityNumber">
            Charity Commission registration number
          </label>
          <input
            className="mt-1 w-full max-w-md rounded-lg border border-black/20 px-3 py-2 text-sm"
            disabled={pending}
            id="charityNumber"
            name="charityNumber"
            placeholder="For example, 1164883"
          />
        </div>
        <div>
          <label className="block text-sm font-bold" htmlFor="companyNumber">
            Companies House company number
          </label>
          <input
            className="mt-1 w-full max-w-md rounded-lg border border-black/20 px-3 py-2 text-sm"
            disabled={pending}
            id="companyNumber"
            name="companyNumber"
            placeholder="For example, 09668396"
          />
        </div>
        <button
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending ? "Looking up…" : "Look up grants"}
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
