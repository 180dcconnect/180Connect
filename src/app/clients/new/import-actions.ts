"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { buildImportDraft } from "@/lib/import/build-draft";
import {
  findImportDuplicateMatch,
  type ExistingOrganisationForImportMatch,
} from "@/lib/import/duplicate-detection";
import { extractOrganisation, isImportUsable } from "@/lib/import/extract-organisation";
import { fetchImportPage } from "@/lib/import/page-transport";
import { resolveRegistry } from "@/lib/import/registry-lookup";
import { storeFetchedPage } from "@/lib/import/store-fetched-page";
import { createCharityCommissionLookupAdapter } from "@/lib/ingestion/sources/charity-commission";
import { createCompaniesHouseAdapter } from "@/lib/ingestion/sources/companieshouse";
import type { RawCharityCommissionRecord } from "@/lib/standardize/charity-commission";
import type { RawCompaniesHouseRecord } from "@/lib/standardize/companies-house";
import { createClient } from "@/lib/supabase/server";

export type ImportDuplicateInfo = {
  organisationId: string;
  legalName: string;
  postcode: string | null;
  registryNumber: string | null;
  matchedOn: "registration_number" | "name_and_postcode" | "website";
};

/**
 * Every outcome the CAM can be shown (F256 / F037).
 *
 * Three distinct failure/edge-case states are required by F256:
 *   1. "unreachable" — URL unreachable, invalid format, blocked by robots, or returned no usable data.
 *   2. "insufficient" — Data returned but falls below minimum threshold; prompt to fill in missing fields manually.
 *   3. "duplicate" — Matches an existing organisation in the database; prompt to view/merge or discard.
 */
export type UrlImportState = {
  kind: "idle" | "unreachable" | "insufficient" | "duplicate" | "error";
  message: string;
  detail?: string;
  /** What was found but not confirmed or missing fields. */
  notes?: string[];
  /** Echoed back so the field keeps the CAM's input after a failure. */
  sourceUrl?: string;
  duplicate?: ImportDuplicateInfo;
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

/** Loads existing active organisations to check for duplicate clients before drafting. */
async function loadExistingOrganisationsForImport(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ExistingOrganisationForImportMatch[]> {
  const organisationRows: { id: string; legal_name: string; postcode: string | null; website: string | null }[] = [];
  const identifierRows: { organisation_id: string; identifier_value: string }[] = [];
  const pageSize = 1_000;

  for (let from = 0; ; from += pageSize) {
    const result = await supabase
      .from("organisations")
      .select("id, legal_name, postcode, website")
      .range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    organisationRows.push(...page);
    if (page.length < pageSize) break;
  }

  for (let from = 0; ; from += pageSize) {
    const result = await supabase
      .from("organisation_identifiers")
      .select("organisation_id, identifier_value")
      .range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    identifierRows.push(...page);
    if (page.length < pageSize) break;
  }

  const numbersByOrg = new Map<string, string[]>();
  for (const row of identifierRows) {
    const existing = numbersByOrg.get(row.organisation_id) ?? [];
    existing.push(row.identifier_value);
    numbersByOrg.set(row.organisation_id, existing);
  }

  return organisationRows.map((org) => ({
    id: org.id,
    legal_name: org.legal_name,
    postcode: org.postcode,
    website: org.website,
    registrationNumbers: numbersByOrg.get(org.id),
  }));
}

/**
 * F037 / F256 Entry Point:
 * Fetches a CAM-supplied URL, checks reachability, extracts data, resolves registries,
 * checks for existing duplicates in the DB, and validates field completeness.
 *
 * A duplicate is NEVER created automatically (F256 AC3).
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
      // State 1: URL unreachable or returns no usable data (F256 AC1)
      return {
        kind: "unreachable",
        message: "Couldn't retrieve data from this URL.",
        detail: page.message,
        sourceUrl,
      };
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

    const supabase = await createClient();

    // State 3: Duplicate detection — check if charity already exists in DB (F256 AC3)
    const candidateRegNumbers: string[] = [
      ...resolution.matches.map((m) => m.registryNumber),
      ...(extraction.charity ? [extraction.charity.number] : []),
      ...(extraction.companyNumber ? [extraction.companyNumber] : []),
    ].filter(Boolean);

    let existingOrganisations: ExistingOrganisationForImportMatch[] = [];
    try {
      existingOrganisations = await loadExistingOrganisationsForImport(supabase);
    } catch (error) {
      await reportError(error, {
        operation: "clients.url_import_load_existing",
        actorUserId: authorization.actor.id,
      });
    }

    const duplicateMatch = findImportDuplicateMatch(
      {
        legalName: extraction.legalName,
        postcode: extraction.postcode,
        website: page.finalUrl,
        registrationNumbers: candidateRegNumbers,
      },
      existingOrganisations,
    );

    if (duplicateMatch) {
      const matchedOrg = existingOrganisations.find(
        (org) => org.id === duplicateMatch.organisationId,
      );
      return {
        kind: "duplicate",
        message: "A matching charity already exists in the database.",
        detail: `This website matches an existing client record (${matchedOrg?.legal_name || "Existing Organisation"}). A duplicate client was not created.`,
        sourceUrl,
        duplicate: {
          organisationId: duplicateMatch.organisationId,
          legalName: matchedOrg?.legal_name || "Existing Client",
          postcode: matchedOrg?.postcode || null,
          registryNumber: matchedOrg?.registrationNumbers?.[0] || null,
          matchedOn: duplicateMatch.matchedOn,
        },
      };
    }

    // State 2: Data returned but below minimum field threshold (F256 AC2)
    if (!isImportUsable(extraction) && resolution.matches.length === 0) {
      return {
        kind: "insufficient",
        message: "Incomplete profile: insufficient data retrieved from this website.",
        detail:
          "We reached the website but could not find enough identifying information to automatically populate a client profile. You can fill in the missing fields manually below, or try a page with full registration details.",
        notes: [
          ...(resolution.notes ?? []),
          ...(extraction.legalName
            ? [`Identified organisation name: "${extraction.legalName}"`]
            : ["No organisation name could be identified from the page."]),
          ...(!extraction.charity && !extraction.companyNumber
            ? ["No charity or company registration number was identified."]
            : []),
          ...(!extraction.postcode ? ["No UK postcode was found on the page."] : []),
          ...(!extraction.contactEmail ? ["No contact email was found on the page."] : []),
        ],
        sourceUrl,
      };
    }

    const draft = buildImportDraft(extraction, resolution.matches, resolution.notes);

    // A failure to store the evidence must not lose the import.
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
      message: "The import could not be completed.",
      detail: "The failure was recorded; please check the address and try again, or add the client by hand.",
      sourceUrl,
    };
  }

  revalidatePath("/clients/new");
  redirect(`/clients/new?draft=${draftId}`);
}

/** F037 / F256: The CAM reviewed the import or duplicate and discards it. */
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
