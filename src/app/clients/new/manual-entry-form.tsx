"use client";

import Link from "next/link";
import { useActionState, useState, type FormEvent } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { discardImportDraft, type UrlImportState } from "./import-actions";
import { saveManualEntry, type ManualEntryState } from "./actions";

export type ManualEntryDraft = {
  id: string;
  legal_name: string | null;
  mission_statement: string | null;
  organisation_type: "charity" | "cio" | "cic" | "social_enterprise" | "ngo" | "company" | "both" | "other" | null;
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
  /** F037: null for an entry the CAM typed from scratch. */
  source_url: string | null;
  imported_field_paths: string[];
  import_notes: string[];
};

const initialState: ManualEntryState = { kind: "idle", message: "" };
const initialImportState: UrlImportState = { kind: "idle", message: "" };
const inputClass = "mt-1 w-full rounded-lg border border-black/20 px-3 py-2";

/**
 * Form field name to MANUAL_ENTRY_RECORDS column.
 *
 * The two differ because the form speaks the language of the action layer and
 * imported_field_paths stores column names — the durable side of the pair. Keeping
 * one map beats renaming either: the stored provenance stays readable in SQL, and the
 * form keeps the names its own server action already parses.
 */
const FIELD_COLUMNS: Readonly<Record<string, string>> = {
  legalName: "legal_name",
  missionStatement: "mission_statement",
  organisationType: "organisation_type",
  addressLine1: "address_line_1",
  city: "city",
  postcode: "postcode",
  countryCode: "country_code",
  website: "website",
  contactEmail: "contact_email",
  registryName: "registry_name",
  registryNumber: "registry_number",
};

/** F037 AC8: says, on the field itself, that this value is not the CAM's own. */
function ImportedBadge() {
  return (
    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900">
      Imported
    </span>
  );
}

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
  const [discardState, discardAction, discarding] = useActionState(
    discardImportDraft,
    initialImportState,
  );
  const entryId = state.entryId ?? initialEntry?.id ?? "";

  // Which imported values are still the imported ones. A field the CAM edits leaves
  // this set immediately, so the badge disappears as they type rather than after a
  // round trip — the label has to stop claiming the value was imported at the
  // moment it stops being true.
  const [importedColumns, setImportedColumns] = useState<string[]>(
    initialEntry?.imported_field_paths ?? [],
  );

  const isImported = (column: string) => importedColumns.includes(column);

  const [organisationType, setOrganisationType] = useState(
    initialEntry?.organisation_type ?? "",
  );

  function handleOrganisationTypeChange(value: string) {
    setOrganisationType(value);
    if (!importedColumns.includes("organisation_type")) return;
    if (initialEntry?.organisation_type === value) return;
    setImportedColumns((columns) => columns.filter((column) => column !== "organisation_type"));
  }

  // One handler on the form rather than eleven on the fields: change events bubble,
  // and the alternative is threading a callback through every label on the page.
  function handleFieldChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement)
      && !(target instanceof HTMLTextAreaElement)
      && !(target instanceof HTMLSelectElement)
    ) {
      return;
    }

    const column = FIELD_COLUMNS[target.name];
    if (!column || !importedColumns.includes(column)) return;

    const original = initialEntry?.[column as keyof ManualEntryDraft];
    if (typeof original === "string" && original.trim() === target.value.trim()) return;

    setImportedColumns((columns) => columns.filter((value) => value !== column));
  }

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
                  {draft.source_url ? "imported, " : ""}
                  updated {new Date(draft.updated_at).toLocaleDateString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {initialEntry?.source_url && (
        <section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <h2 className="font-bold">Imported client information</h2>
          <p className="mt-1">
            The fields marked <span className="font-medium">Imported</span> were filled
            from{" "}
            <a
              className="font-medium underline"
              href={initialEntry.source_url}
              rel="noreferrer nofollow noopener"
              target="_blank"
            >
              {initialEntry.source_url}
            </a>{" "}
            and confirmed against public registers. Check every one of them before you submit — nothing here is saved as a
            client until you do.
          </p>
          {initialEntry.import_notes.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {initialEntry.import_notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          <form action={discardAction} className="mt-3">
            <input name="entryId" type="hidden" value={initialEntry.id} />
            <button
              className="rounded-lg border border-blue-300 px-3 py-1.5 font-bold text-blue-900 disabled:opacity-50"
              disabled={discarding}
              type="submit"
            >
              {discarding ? "Discarding…" : "Discard this import"}
            </button>
          </form>
          {discardState.message && (
            <p className="mt-2 text-red-900" role="alert">{discardState.message}</p>
          )}
        </section>
      )}

      <form action={action} className="mt-6 space-y-5" onChange={handleFieldChange}>
        <input name="entryId" type="hidden" value={entryId} />
        {initialEntry?.source_url && (
          <input
            name="importedFieldPaths"
            type="hidden"
            value={JSON.stringify(importedColumns)}
          />
        )}

        <label className="block text-sm font-bold">Organisation name
          {isImported("legal_name") && <ImportedBadge />}
          <input className={inputClass} defaultValue={initialEntry?.legal_name ?? ""} maxLength={200} name="legalName" required />
        </label>

        <label className="block text-sm font-bold">Mission
          {isImported("mission_statement") && <ImportedBadge />}
          <textarea className={inputClass} defaultValue={initialEntry?.mission_statement ?? ""} maxLength={5000} name="missionStatement" required rows={4} />
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-bold">Organisation type
            {isImported("organisation_type") && <ImportedBadge />}
            <input name="organisationType" type="hidden" value={organisationType} />
            <Select value={organisationType} onValueChange={handleOrganisationTypeChange}>
              <SelectTrigger className={`${inputClass} w-full`}>
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="charity">Charity</SelectItem>
                <SelectItem value="cio">CIO</SelectItem>
                <SelectItem value="cic">CIC</SelectItem>
                <SelectItem value="social_enterprise">Social enterprise</SelectItem>
                <SelectItem value="ngo">NGO</SelectItem>
                <SelectItem value="company">Company</SelectItem>
                <SelectItem value="both">Charity and company</SelectItem>
                <SelectItem value="other">Other organisation</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="block text-sm font-bold">Country code
            {isImported("country_code") && <ImportedBadge />}
            <input className={inputClass} defaultValue={initialEntry?.country_code ?? "GB"} maxLength={2} name="countryCode" pattern="[A-Za-z]{2}" required />
          </label>
        </div>

        <fieldset className="rounded-xl border border-black/10 p-4">
          <legend className="px-1 text-sm font-bold">Full address</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold sm:col-span-2">Address line 1
              {isImported("address_line_1") && <ImportedBadge />}
              <input className={inputClass} defaultValue={initialEntry?.address_line_1 ?? ""} maxLength={300} name="addressLine1" required />
            </label>
            <label className="block text-sm font-bold">Town or city
              {isImported("city") && <ImportedBadge />}
              <input className={inputClass} defaultValue={initialEntry?.city ?? ""} maxLength={200} name="city" required />
            </label>
            <label className="block text-sm font-bold">Postcode or postal code
              {isImported("postcode") && <ImportedBadge />}
              <input className={inputClass} defaultValue={initialEntry?.postcode ?? ""} maxLength={32} name="postcode" required />
            </label>
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-bold">Website
            {isImported("website") && <ImportedBadge />}
            <input className={inputClass} defaultValue={initialEntry?.website ?? ""} maxLength={500} name="website" placeholder="https://example.org" required />
          </label>
          <label className="block text-sm font-bold">Contact email
            {isImported("contact_email") && <ImportedBadge />}
            <input className={inputClass} defaultValue={initialEntry?.contact_email ?? ""} maxLength={320} name="contactEmail" type="text" required />
          </label>
          <label className="block text-sm font-bold">Registry name
            {isImported("registry_name") && <ImportedBadge />}
            <input className={inputClass} defaultValue={initialEntry?.registry_name ?? ""} maxLength={200} name="registryName" required />
          </label>
          <label className="block text-sm font-bold">Registry number
            {isImported("registry_number") && <ImportedBadge />}
            <input className={inputClass} defaultValue={initialEntry?.registry_number ?? ""} maxLength={200} name="registryNumber" required />
          </label>
        </div>

        <label className="block text-sm font-bold">Why is manual entry needed?
          <textarea
            className={inputClass}
            defaultValue={
              initialEntry?.reason_for_manual_entry
              ?? (initialEntry?.source_url
                ? `Imported from ${initialEntry.source_url} and reviewed by hand.`
                : "")
            }
            maxLength={2000}
            minLength={10}
            name="reason"
            required
            rows={4}
          />
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
          <OriginButton
            variant="outline"
            size="md"
            disabled={pending}
            formNoValidate
            name="intent"
            type="submit"
            value="draft"
          >
            {pending ? "Saving…" : "Save draft"}
          </OriginButton>
          <OriginButton
            size="md"
            disabled={pending}
            loading={pending}
            name="intent"
            type="submit"
            value="submit"
          >
            {pending ? "Submitting…" : isAdmin ? "Create active client" : "Submit for review"}
          </OriginButton>
        </div>
      </form>
    </>
  );
}
