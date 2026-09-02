"use client";

import { useActionState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
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
    <div className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
      <h2 className="text-sm font-bold text-foreground">Check for new registrations</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-[1.6] text-foreground/65">
        Searches the register for charities registered since the last run, and
        keeps the ones in the branch&rsquo;s postcode areas. This already runs
        automatically every week — clicking it only brings the next run forward.
      </p>
      <p className="mt-2 max-w-2xl text-xs leading-[1.6] text-foreground/50">
        These charities have not filed accounts yet, so their Financials tab will
        be empty. That is the register being new, not an import failing.
      </p>

      {!configured && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900" role="alert">
          Charity Commission API access is not configured. Add the server-side API
          key before running an import.
        </p>
      )}

      <form action={action} className="mt-5">
        <OriginButton
          disabled={!configured || pending}
          loading={pending}
          size="md"
          type="submit"
        >
          {pending ? "Checking…" : "Check for new registrations"}
        </OriginButton>
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
