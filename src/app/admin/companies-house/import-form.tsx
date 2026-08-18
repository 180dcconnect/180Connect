"use client";

import { useActionState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  importCompaniesHouse,
  type CompaniesHouseImportState,
} from "./actions";

const initialCompaniesHouseImportState: CompaniesHouseImportState = {
  kind: "idle",
  message: "",
};

const stateStyles = {
  success: "bg-green-50 text-green-900",
  warning: "bg-amber-50 text-amber-900",
  error: "bg-red-50 text-red-900",
} as const;

export function CompaniesHouseImportForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(
    importCompaniesHouse,
    initialCompaniesHouseImportState,
  );

  return (
    <div className="mt-8 rounded-xl border border-black/10 p-5">
      <h2 className="text-lg font-bold">Look up one company</h2>
      <p className="mt-2 text-sm text-foreground/65">
        Enter a company number when known. Otherwise, enter the exact registered
        name. For matching many companies at once, use bulk search below instead.
      </p>

      {!configured && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900" role="alert">
          Companies House API access is not configured. Add the server-side API key
          before running an import.
        </p>
      )}

      <form action={action} className="mt-5 space-y-4">
        <div>
          <label className="block text-sm font-bold" htmlFor="companyNumber">
            Company number
          </label>
          <input
            className="mt-1 w-full max-w-md rounded-lg border border-black/20 px-3 py-2 text-sm"
            disabled={!configured || pending}
            id="companyNumber"
            name="companyNumber"
            placeholder="For example, 01234567"
          />
          <p className="mt-1 text-xs text-foreground/60">Preferred when available.</p>
        </div>
        <div>
          <label className="block text-sm font-bold" htmlFor="registeredName">
            Registered name
          </label>
          <input
            className="mt-1 w-full max-w-md rounded-lg border border-black/20 px-3 py-2 text-sm"
            disabled={!configured || pending}
            id="registeredName"
            name="registeredName"
            placeholder="Used only when the company number is unknown"
          />
        </div>
        <OriginButton
          disabled={!configured || pending}
          loading={pending}
          size="md"
          type="submit"
        >
          {pending ? "Importing…" : "Import Companies House data"}
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
          {state.promoteCounts && (
            <>
              <p className="mt-4 text-xs font-bold uppercase opacity-60">Promoted to organisations</p>
              <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
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
