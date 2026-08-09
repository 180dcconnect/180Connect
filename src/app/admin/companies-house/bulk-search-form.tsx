"use client";

import { useActionState } from "react";
import {
  importCompaniesHouseBulk,
  type CompaniesHouseImportState,
} from "./actions";

const initialState: CompaniesHouseImportState = {
  kind: "idle",
  message: "",
};

const stateStyles = {
  success: "bg-green-50 text-green-900",
  warning: "bg-amber-50 text-amber-900",
  error: "bg-red-50 text-red-900",
} as const;

export function CompaniesHouseBulkSearchForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(importCompaniesHouseBulk, initialState);

  return (
    <div className="mt-8 rounded-xl border border-black/10 p-5">
      <h2 className="text-lg font-bold">Bulk search and import</h2>
      <p className="mt-2 text-sm text-foreground/65">
        Searches the Companies House register for companies matching the criteria
        below and imports every match not already in the ingestion queue. The
        UK register has over 5 million active companies — enter a SIC code, a
        location, or both to scope the search.
      </p>

      {!configured && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900" role="alert">
          Companies House API access is not configured. Add the server-side API key
          before running an import.
        </p>
      )}

      <form action={action} className="mt-5 space-y-4">
        <div>
          <label className="block text-sm font-bold" htmlFor="sicCodes">
            SIC code(s)
          </label>
          <input
            className="mt-1 w-full max-w-md rounded-lg border border-black/20 px-3 py-2 text-sm"
            disabled={!configured || pending}
            id="sicCodes"
            name="sicCodes"
            placeholder="For example, 62012, 62020"
          />
          <p className="mt-1 text-xs text-foreground/60">Comma-separated. Identifies the industry sector.</p>
        </div>
        <div>
          <label className="block text-sm font-bold" htmlFor="location">
            Location
          </label>
          <input
            className="mt-1 w-full max-w-md rounded-lg border border-black/20 px-3 py-2 text-sm"
            disabled={!configured || pending}
            id="location"
            name="location"
            placeholder="For example, Manchester"
          />
        </div>
        <div>
          <label className="block text-sm font-bold" htmlFor="companyStatus">
            Company status
          </label>
          <select
            className="mt-1 w-full max-w-md rounded-lg border border-black/20 px-3 py-2 text-sm"
            defaultValue="active"
            disabled={!configured || pending}
            id="companyStatus"
            name="companyStatus"
          >
            <option value="active">Active</option>
            <option value="dissolved">Dissolved</option>
            <option value="liquidation">Liquidation</option>
          </select>
        </div>
        <button
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!configured || pending}
          type="submit"
        >
          {pending ? "Searching…" : "Search and import"}
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
