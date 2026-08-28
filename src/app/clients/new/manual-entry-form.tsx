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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InlineAlert } from "@/components/ui/inline-alert";
import { discardImportDraft, type UrlImportState } from "./import-actions";
import { saveManualEntry, type ManualEntryState } from "./actions";

export type ManualEntryDraft = {
  id: string;
  legal_name: string | null;
  mission_statement: string | null;
  organisation_type:
    | "charity"
    | "cio"
    | "cic"
    | "social_enterprise"
    | "ngo"
    | "company"
    | "both"
    | "other"
    | null;
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
    <span className="ml-2 rounded-full bg-brand/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand">
      Imported
    </span>
  );
}

function FieldLabel({
  htmlFor,
  children,
  imported,
}: {
  htmlFor: string;
  children: React.ReactNode;
  imported?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70"
    >
      {children}
      {imported && <ImportedBadge />}
    </label>
  );
}

// The app's text field styling, tuned to match the existing pages: a taller
// control than the shadcn default with the hairline border and brand focus ring
// used across /clients and /admin.
const textClass =
  "mt-1.5 h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";
const textareaClass =
  "mt-1.5 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";

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
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement) &&
      !(target instanceof HTMLSelectElement)
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
        <aside className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
            Your saved drafts
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link
                  className="font-bold text-brand hover:underline"
                  href={`/clients/new?draft=${draft.id}`}
                >
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
        <section className="rounded-xl border border-brand/15 bg-brand/[0.04] p-4 text-sm text-foreground">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
            Imported client information
          </p>
          <p className="mt-1 leading-[1.7]">
            The fields marked <span className="font-bold">Imported</span> were filled from{" "}
            <a
              className="font-bold underline underline-offset-2"
              href={initialEntry.source_url}
              rel="noreferrer nofollow noopener"
              target="_blank"
            >
              {initialEntry.source_url}
            </a>{" "}
            and confirmed against public registers. Check every one of them before you submit —
            nothing here is saved as a client until you do.
          </p>
          {initialEntry.import_notes.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {initialEntry.import_notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <form action={discardAction} className="mt-3">
            <input name="entryId" type="hidden" value={initialEntry.id} />
            <OriginButton
              variant="outline"
              size="sm"
              disabled={discarding}
              loading={discarding}
              type="submit"
            >
              {discarding ? "Discarding…" : "Discard this import"}
            </OriginButton>
          </form>
          {discardState.message && (
            <div className="mt-2">
              <InlineAlert
                variant="inline"
                tone={discardState.kind === "error" ? "error" : "neutral"}
                message={discardState.message}
              />
            </div>
          )}
        </section>
      )}

      <form action={action} className="mt-6 space-y-6" onChange={handleFieldChange}>
        <input name="entryId" type="hidden" value={entryId} />
        {initialEntry?.source_url && (
          <input name="importedFieldPaths" type="hidden" value={JSON.stringify(importedColumns)} />
        )}

        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="legal-name" imported={isImported("legal_name")}>
            Organisation name
          </FieldLabel>
          <Input
            id="legal-name"
            className={textClass}
            defaultValue={initialEntry?.legal_name ?? ""}
            maxLength={200}
            name="legalName"
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="mission" imported={isImported("mission_statement")}>
            Mission
          </FieldLabel>
          <Textarea
            id="mission"
            className={textareaClass}
            defaultValue={initialEntry?.mission_statement ?? ""}
            maxLength={5000}
            name="missionStatement"
            required
            rows={4}
          />
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="type" imported={isImported("organisation_type")}>
              Organisation type
            </FieldLabel>
            <input name="organisationType" type="hidden" value={organisationType} />
            <Select value={organisationType} onValueChange={handleOrganisationTypeChange}>
              <SelectTrigger
                id="type"
                className="mt-1.5 h-10 w-full rounded-lg border border-black/15 bg-white"
              >
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
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="country" imported={isImported("country_code")}>
              Country code
            </FieldLabel>
            <Input
              id="country"
              className={textClass}
              defaultValue={initialEntry?.country_code ?? "GB"}
              maxLength={2}
              name="countryCode"
              pattern="[A-Za-z]{2}"
              required
            />
          </div>
        </div>

        <fieldset className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-4 sm:p-5">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
            Full address
          </legend>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <FieldLabel htmlFor="addr" imported={isImported("address_line_1")}>
                Address line 1
              </FieldLabel>
              <Input
                id="addr"
                className={textClass}
                defaultValue={initialEntry?.address_line_1 ?? ""}
                maxLength={300}
                name="addressLine1"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="city" imported={isImported("city")}>
                Town or city
              </FieldLabel>
              <Input
                id="city"
                className={textClass}
                defaultValue={initialEntry?.city ?? ""}
                maxLength={200}
                name="city"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="postcode" imported={isImported("postcode")}>
                Postcode or postal code
              </FieldLabel>
              <Input
                id="postcode"
                className={textClass}
                defaultValue={initialEntry?.postcode ?? ""}
                maxLength={32}
                name="postcode"
                required
              />
            </div>
          </div>
        </fieldset>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="website" imported={isImported("website")}>
              Website
            </FieldLabel>
            <Input
              id="website"
              className={textClass}
              defaultValue={initialEntry?.website ?? ""}
              maxLength={500}
              name="website"
              placeholder="https://example.org"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="email" imported={isImported("contact_email")}>
              Contact email
            </FieldLabel>
            <Input
              id="email"
              className={textClass}
              defaultValue={initialEntry?.contact_email ?? ""}
              maxLength={320}
              name="contactEmail"
              type="text"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="registry-name" imported={isImported("registry_name")}>
              Registry name
            </FieldLabel>
            <Input
              id="registry-name"
              className={textClass}
              defaultValue={initialEntry?.registry_name ?? ""}
              maxLength={200}
              name="registryName"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="registry-number" imported={isImported("registry_number")}>
              Registry number
            </FieldLabel>
            <Input
              id="registry-number"
              className={textClass}
              defaultValue={initialEntry?.registry_number ?? ""}
              maxLength={200}
              name="registryNumber"
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reason" className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70">
            Why is manual entry needed?
          </label>
          <Textarea
            id="reason"
            className={textareaClass}
            defaultValue={
              initialEntry?.reason_for_manual_entry ??
              (initialEntry?.source_url
                ? `Imported from ${initialEntry.source_url} and reviewed by hand.`
                : "")
            }
            maxLength={2000}
            minLength={10}
            name="reason"
            required
            rows={4}
          />
        </div>

        {isAdmin && (
          <label className="flex items-start gap-3 rounded-xl border border-brand/15 bg-brand/[0.04] p-4 text-sm leading-[1.7]">
            <input className="mt-1 size-4 accent-brand" name="adminConfirmedEligible" type="checkbox" />
            <span>
              For a company or other organisation, I confirm it is an eligible non-profit, social
              enterprise, NGO or socially focused startup.
            </span>
          </label>
        )}

        {state.message && (
          <InlineAlert
            variant="page"
            tone={
              state.kind === "success" ? "success" : state.kind === "warning" ? "warning" : "error"
            }
            message={state.message}
          />
        )}
        {state.warnings && state.warnings.length > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-5 py-4">
            <p className="text-sm font-bold text-amber-700">Saved with field warnings</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-700">
              {state.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        {state.organisationId && (
          <Link className="inline-block font-bold text-brand hover:underline" href={`/clients/${state.organisationId}`}>
            Open the active client profile
          </Link>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
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