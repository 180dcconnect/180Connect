"use client";

import { useActionState } from "react";
import {
  checkAvailableManualEntryDependencies,
  type ManualEntryReviewState,
} from "./actions";

const initialState: ManualEntryReviewState = { kind: "idle", message: "" };

const checkStyles = {
  passed: "border-green-200 bg-green-50 text-green-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  blocked: "border-red-200 bg-red-50 text-red-900",
  pending: "border-gray-200 bg-gray-50 text-gray-800",
} as const;

export function ManualEntryReviewForm({ entryId }: { entryId: string }) {
  const [state, action, pending] = useActionState(
    checkAvailableManualEntryDependencies,
    initialState,
  );

  return (
    <div className="mt-4 rounded-xl border border-black/10 bg-gray-50 p-4">
      <h3 className="text-sm font-bold">Approval checks</h3>
      <form action={action} className="mt-3 space-y-3">
        <input name="id" type="hidden" value={entryId} />
        <label className="block text-sm font-bold">
          Organisation type
          <select
            className="mt-1 w-full rounded-lg border border-black/20 bg-white px-3 py-2"
            defaultValue=""
            name="organisationType"
            required
          >
            <option disabled value="">Choose a type</option>
            <option value="charity">Charity</option>
            <option value="both">Charity and company</option>
            <option value="company">Company</option>
            <option value="other">Other organisation</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input className="mt-1" name="adminConfirmedEligible" type="checkbox" />
          <span>
            I have confirmed that an ambiguous company/other organisation is a
            non-profit, social enterprise, NGO or socially focused startup.
          </span>
        </label>
        <button
          className="rounded-lg border border-brand px-3 py-2 text-sm font-bold text-brand disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending ? "Running checks…" : "Run available checks"}
        </button>
      </form>

      {state.message && (
        <p
          className={`mt-3 rounded-lg p-3 text-sm ${state.kind === "error" ? "bg-red-50 text-red-900" : "bg-blue-50 text-blue-900"}`}
          role={state.kind === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      )}
      {state.checks && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {state.checks.map((check) => (
            <li className={`rounded-lg border p-3 text-sm ${checkStyles[check.status]}`} key={check.label}>
              <p className="font-bold">{check.label}: {check.status}</p>
              <p className="mt-1">{check.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
