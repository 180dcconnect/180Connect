"use client";

import { useActionState } from "react";
import {
  importCharityCommissionAuto,
  type CharityCommissionImportState,
} from "./actions";

const initialState: CharityCommissionImportState = {
  kind: "idle",
  message: "",
};

const stateStyles = {
  success: "bg-green-50 text-green-900",
  warning: "bg-amber-50 text-amber-900",
  error: "bg-red-50 text-red-900",
} as const;

export function CharityCommissionImportAutoButton({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(importCharityCommissionAuto, initialState);

  return (
    <div className="rounded-xl border border-black/10 p-5">
      <h2 className="text-lg font-bold">Discover new charities</h2>
      <p className="mt-2 text-sm text-foreground/65">
        Searches the Charity Commission register for charities registered since the
        last successful import and imports every new match. No details to enter.
        The same search runs automatically every week, so new registrations keep
        getting picked up without clicking this again.
      </p>

      {!configured && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900" role="alert">
          Charity Commission API access is not configured. Add the server-side API
          key before running an import.
        </p>
      )}

      <form action={action} className="mt-5">
        <button
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!configured || pending}
          type="submit"
        >
          {pending ? "Importing…" : "Discover new charities"}
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
          {state.promoted && (
            <>
              <p className="mt-4 text-xs font-bold uppercase tracking-wide opacity-60">
                Promoted to the client list
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {Object.entries(state.promoted).map(([label, value]) => (
                  <div key={label}>
                    <dt className="capitalize opacity-70">
                      {label.replace(/([A-Z])/g, " $1")}
                    </dt>
                    <dd className="text-lg font-bold">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      )}
    </div>
  );
}
