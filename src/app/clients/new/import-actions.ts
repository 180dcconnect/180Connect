"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { buildImportDraft } from "@/lib/import/build-draft";
import { extractOrganisation, isImportUsable } from "@/lib/import/extract-organisation";
import { fetchImportPage } from "@/lib/import/page-transport";
import { resolveRegistry } from "@/lib/import/registry-lookup";
import { storeFetchedPage } from "@/lib/import/store-fetched-page";
import { createCharityCommissionLookupAdapter } from "@/lib/ingestion/sources/charity-commission";
import { createCompaniesHouseAdapter } from "@/lib/ingestion/sources/companieshouse";
import type { RawCharityCommissionRecord } from "@/lib/standardize/charity-commission";
import type { RawCompaniesHouseRecord } from "@/lib/standardize/companies-house";
import { createClient } from "@/lib/supabase/server";

/**
 * Every outcome the CAM can be shown. "failed" and "insufficient" are separate
 * because they need different next steps from the CAM — one is "check the address",
 * the other is "this site does not say enough, type it instead" — which is the
 * distinction F256 exists to make.
 */
export type UrlImportState = {
  kind: "idle" | "failed" | "insufficient" | "error";
  message: string;
  /** What was found but not confirmed. Shown under the message, never instead of it. */
  notes?: string[];
  /** Echoed back so the field keeps the CAM's input after a failure. */
  sourceUrl?: string;
};

/** The adapters return CommonRecord; the import only needs the payload inside. */
async function lookupCharity(registeredNumber: string): Promise<RawCharityCommissionRecord> {
  const result = await createCharityCommissionLookupAdapter({ registeredNumber }).fetch();
  const record = result.records[0];
  if (!record) throw new Error("Charity Commission returned no record for that number.");
  return record.raw_payload as RawCharityCommissionRecord;
}

async function lookupCompany(
  lookup: { companyNumber: string } | { registeredName: string },
): Promise<RawCompaniesHouseRecord & { company_number: string }> {
  const result = await createCompaniesHouseAdapter(lookup).fetch();
  const record = result.records[0];
  if (!record) throw new Error("Companies House returned no record for that lookup.");
  return record.raw_payload as RawCompaniesHouseRecord & { company_number: string };
}

/**
 * F037's entry point: fetch a CAM-supplied URL, read what it says, confirm it against
 * the registers, and leave a draft for review.
 *
 * Nothing here creates an organisation. The import stops at a draft the CAM has to
 * open, check and submit — AC9 ("imported data is not saved where the CAM has not
 * explicitly confirmed the import") is enforced by there being no code path from this
 * function to an active client.
 */
export async function importFromUrl(
  _previous: UrlImportState,
  formData: FormData,
): Promise<UrlImportState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  let draftId: string;

  try {
    const page = await fetchImportPage(sourceUrl);
    if (page.status !== "fetched") {
      return { kind: "failed", message: page.message, sourceUrl };
    }

    const extraction = extractOrganisation(page.html, page.finalUrl);
    const resolution = await resolveRegistry(extraction, {
      lookupCharity,
      lookupCompany,
      async onFailure(error, context) {
        await reportError(error, {
          operation: "clients.url_import_registry",
          actorUserId: authorization.actor.id,
          ...context,
        });
      },
    });

    // Nothing identifiable and nothing confirmed is an insufficient import, not a
    // half-filled form: a draft whose only content is a page title wastes more of the
    // CAM's time than a blank one.
    if (!isImportUsable(extraction) && resolution.matches.length === 0) {
      return {
        kind: "insufficient",
        message:
          "We reached that website but could not find enough to identify the organisation. " +
          "Add it by hand below, or try the page that carries their registration details.",
        notes: resolution.notes,
        sourceUrl,
      };
    }

    const draft = buildImportDraft(extraction, resolution.matches, resolution.notes);

    // A failure to store the evidence must not lose the import. The draft still
    // records the URL it came from; only the link to the stored page is missing.
    let rawRecordId: string | null = null;
    try {
      const stored = await storeFetchedPage(page, authorization.actor.id);
      rawRecordId = stored.rawRecordId;
    } catch (error) {
      await reportError(error, {
        operation: "clients.url_import_store_page",
        actorUserId: authorization.actor.id,
        sourceUrl: page.finalUrl,
      });
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_url_import_draft", {
      p_source_url: page.finalUrl,
      p_raw_record_id: rawRecordId,
      p_imported_field_paths: draft.importedFieldPaths,
      p_import_notes: draft.notes,
      p_legal_name: draft.fields.legal_name,
      p_mission_statement: draft.fields.mission_statement,
      p_organisation_type: draft.fields.organisation_type,
      p_address_line_1: draft.fields.address_line_1,
      p_city: draft.fields.city,
      p_postcode: draft.fields.postcode,
      p_country_code: draft.fields.country_code,
      p_website: draft.fields.website,
      p_contact_email: draft.fields.contact_email,
      p_registry_name: draft.fields.registry_name,
      p_registry_number: draft.fields.registry_number,
    });
    if (error) throw error;

    draftId = String(data);
  } catch (error) {
    await reportError(error, {
      operation: "clients.url_import",
      actorUserId: authorization.actor.id,
      sourceUrl,
    });
    return {
      kind: "error",
      message: "The import could not be completed. The failure was recorded; try again, or add the client by hand.",
      sourceUrl,
    };
  }

  // Outside the try: redirect works by throwing, and catching it here would turn a
  // successful import into the generic failure message above.
  revalidatePath("/clients/new");
  redirect(`/clients/new?draft=${draftId}`);
}

/** F037: the CAM reviewed the import and does not want it. */
export async function discardImportDraft(
  _previous: UrlImportState,
  formData: FormData,
): Promise<UrlImportState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const entryId = String(formData.get("entryId") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) {
    return { kind: "error", message: "This draft could not be identified." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("discard_manual_entry_draft", { p_entry_id: entryId });
    if (error) throw error;
  } catch (error) {
    await reportError(error, {
      operation: "clients.url_import_discard",
      actorUserId: authorization.actor.id,
      manualEntryId: entryId,
    });
    return {
      kind: "error",
      message: "The import could not be discarded. The failure was recorded; please try again.",
    };
  }

  revalidatePath("/clients/new");
  redirect("/clients/new");
}
