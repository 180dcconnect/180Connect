"use client";

import { useActionState } from "react";
import { importThreeSixtyGiving, type ThreeSixtyGivingImportState } from "./actions";

const initialImportState: ThreeSixtyGivingImportState = {
  kind: "idle",
  message: "",
};

const stateStyles = {
  success: "bg-green-50 text-green-900",
  warning: "bg-amber-50 text-amber-900",
  error: "bg-red-50 text-red-900",
} as const;

export function ThreeSixtyGivingImportForm() {
  const [state, action, pending] = useActionState(importThreeSixtyGiving, initialImportState);

  return (
    <div className="mt-8 rounded-xl border border-black/10 p-5">
      <h2 className="text-lg font-bold">Run import</h2>
      <p className="mt-2 text-sm text-foreground/65">
        Walks every charity and company already known to the pipeline and
        pulls in any grants 360Giving has on record for them. Only ever
        attaches grants to an existing charity — it never creates a new one.
        For a single known charity or company, use the lookup below instead.
      </p>
      <form action={action} className="mt-5">
        <button
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending ? "Importing…" : "Import 360Giving data"}
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
          {state.promoteCounts && (
            <>
              <p className="mt-4 font-bold">Matched to charities</p>
              <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(state.promoteCounts).map(([label, value]) => (
                  <div key={label}>
                    <dt className="capitalize opacity-70">{label}</dt>
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
