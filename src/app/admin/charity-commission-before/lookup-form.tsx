"use client";

import { useActionState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { lookupCharity, type CharityCommissionImportState } from "../charity-commission/actions";

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
    <div className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
      <h2 className="text-sm font-bold text-foreground">Look up one charity</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-[1.6] text-foreground/65">
        For a charity someone has named. Enter its registration number to fetch
        that one record. The bulk import&rsquo;s criteria below are not applied,
        so this reaches a charity outside the branch&rsquo;s usual patch — it
        still goes through the standard client-criteria check on the way into
        the list, and may land there flagged for review.
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
        <OriginButton
          disabled={!configured || pending}
          loading={pending}
          size="md"
          type="submit"
        >
          {pending ? "Looking up…" : "Look up charity"}
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
