"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveManualEntry, type ManualEntryState } from "./actions";

export type ManualEntryDraft = {
  id: string;
  legal_name: string | null;
  mission_statement: string | null;
  organisation_type: "charity" | "company" | "both" | "other" | null;
  address_line_1: string | null;
  city: string | null;
  postcode: string | null;
  country_code: string | null;
  website: string | null;
  contact_email: string | null;
  registry_name: string | null;
  registry_number: string | null;
  reason_for_manual_entry: string | null;
  updated_at: string;
};

const initialState: ManualEntryState = { kind: "idle", message: "" };
const inputClass = "mt-1 w-full rounded-lg border border-black/20 px-3 py-2";

export function ManualEntryForm({
  initialEntry,
  drafts,
  isAdmin,
}: {
  initialEntry: ManualEntryDraft | null;
  drafts: ManualEntryDraft[];
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveManualEntry, initialState);
  const entryId = state.entryId ?? initialEntry?.id ?? "";

  return (
    <>
      {drafts.length > 0 && (
        <aside className="mt-6 rounded-xl border border-black/10 bg-gray-50 p-4">
          <h2 className="text-sm font-bold">Your saved drafts</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link className="font-medium text-brand hover:underline" href={`/clients/new?draft=${draft.id}`}>
                  {draft.legal_name || "Untitled manual entry"}
                </Link>{" "}
                <span className="text-foreground/55">
                  updated {new Date(draft.updated_at).toLocaleDateString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <form action={action} className="mt-6 space-y-5">
        <input name="entryId" type="hidden" value={entryId} />

        <label className="block text-sm font-bold">Organisation name
          <input className={inputClass} defaultValue={initialEntry?.legal_name ?? ""} maxLength={200} name="legalName" required />
        </label>

        <label className="block text-sm font-bold">Mission
          <textarea className={inputClass} defaultValue={initialEntry?.mission_statement ?? ""} maxLength={5000} name="missionStatement" required rows={4} />
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-bold">Organisation type
            <select className={inputClass} defaultValue={initialEntry?.organisation_type ?? ""} name="organisationType" required>
              <option disabled value="">Choose a type</option>
              <option value="charity">Charity</option>
              <option value="both">Charity and company</option>
              <option value="company">Company</option>
              <option value="other">Other organisation</option>
            </select>
          </label>
          <label className="block text-sm font-bold">Country code
            <input className={inputClass} defaultValue={initialEntry?.country_code ?? "GB"} maxLength={2} name="countryCode" pattern="[A-Za-z]{2}" required />
          </label>
        </div>

        <fieldset className="rounded-xl border border-black/10 p-4">
          <legend className="px-1 text-sm font-bold">Full address</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold sm:col-span-2">Address line 1
              <input className={inputClass} defaultValue={initialEntry?.address_line_1 ?? ""} maxLength={300} name="addressLine1" required />
            </label>
            <label className="block text-sm font-bold">Town or city
              <input className={inputClass} defaultValue={initialEntry?.city ?? ""} maxLength={200} name="city" required />
            </label>
            <label className="block text-sm font-bold">Postcode or postal code
              <input className={inputClass} defaultValue={initialEntry?.postcode ?? ""} maxLength={32} name="postcode" required />
            </label>
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-bold">Website
            <input className={inputClass} defaultValue={initialEntry?.website ?? ""} maxLength={500} name="website" placeholder="https://example.org" required />
          </label>
          <label className="block text-sm font-bold">Contact email
            <input className={inputClass} defaultValue={initialEntry?.contact_email ?? ""} maxLength={320} name="contactEmail" type="text" required />
          </label>
          <label className="block text-sm font-bold">Registry name
            <input className={inputClass} defaultValue={initialEntry?.registry_name ?? ""} maxLength={200} name="registryName" required />
          </label>
          <label className="block text-sm font-bold">Registry number
            <input className={inputClass} defaultValue={initialEntry?.registry_number ?? ""} maxLength={200} name="registryNumber" required />
          </label>
        </div>

        <label className="block text-sm font-bold">Why is manual entry needed?
          <textarea className={inputClass} defaultValue={initialEntry?.reason_for_manual_entry ?? ""} maxLength={2000} minLength={10} name="reason" required rows={4} />
        </label>

        {isAdmin && (
          <label className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-950">
            <input className="mt-1" name="adminConfirmedEligible" type="checkbox" />
            <span>
              For a company or other organisation, I confirm it is an eligible non-profit,
              social enterprise, NGO or socially focused startup.
            </span>
          </label>
        )}

        {state.message && (
          <p
            className={`rounded-lg p-3 text-sm ${state.kind === "success" ? "bg-green-50 text-green-800" : state.kind === "warning" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"}`}
            role={state.kind === "error" ? "alert" : "status"}
          >
            {state.message}
          </p>
        )}
        {state.warnings && state.warnings.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            <p className="font-bold">Saved with field warnings</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {state.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}
        {state.organisationId && (
          <Link className="inline-block font-bold text-brand hover:underline" href={`/clients/${state.organisationId}`}>
            Open the active client profile
          </Link>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-lg border border-brand px-4 py-2 font-bold text-brand disabled:opacity-50"
            disabled={pending}
            formNoValidate
            name="intent"
            type="submit"
            value="draft"
          >
            {pending ? "Saving…" : "Save draft"}
          </button>
          <button
            className="rounded-lg bg-brand px-4 py-2 font-bold text-white disabled:opacity-50"
            disabled={pending}
            name="intent"
            type="submit"
            value="submit"
          >
            {pending ? "Submitting…" : isAdmin ? "Create active client" : "Submit for review"}
          </button>
        </div>
      </form>
    </>
  );
}
