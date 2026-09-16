"use server";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { runIngestion } from "@/lib/ingestion/runner";
import {
  createCompaniesHouseAdapter,
  normalizeCompanyNumber,
  type CompaniesHouseLookup,
} from "@/lib/ingestion/sources/companieshouse";
import { promotePendingCompaniesHouseRecords } from "@/lib/standardize/write-organisations";
import {
  companyLookupOutcome,
  importStateFromSummary,
  type CompanyLookupOutcome,
  type ListedCompany,
} from "./import-result";
import {
  createDefaultCompanyPreviewDependencies,
  previewCompany,
  type CompanyPreview,
} from "@/lib/import/company-preview";

export type CompaniesHouseImportState = {
  kind: "idle" | "success" | "warning" | "error";
  message: string;
  counts?: {
    fetched: number;
    written: number;
    skipped: number;
    failed: number;
  };
  promoteCounts?: {
    inserted: number;
    rejected: number;
    needsReview: number;
    doesNotMeet: number;
    failed: number;
  };
  /**
   * What happened to the one company that was looked up, as opposed to the
   * batch counters above.
   */
  outcome?: CompanyLookupOutcome;
};

/**
 * Step one's result: what the company looks like, before anything is written.
 */
export type CompanyPreviewState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "preview";
      preview: CompanyPreview;
      alreadyListed: ListedCompany | null;
    };

/**
 * The company on the client list carrying this company number, if any.
 */
async function findListedCompany(companyNumber: string): Promise<ListedCompany | null> {
  const normalized = normalizeCompanyNumber(companyNumber);
  const supabase = await createClient();

  const { data: identifier, error: identifierError } = await supabase
    .from("organisation_identifiers")
    .select("organisation_id")
    .in("identifier_type", ["uk_company", "companies_house"])
    .in("identifier_value", [normalized, companyNumber.trim()])
    .limit(1)
    .maybeSingle<{ organisation_id: string }>();
  if (identifierError || !identifier) return null;

  const [{ data: organisation }, { count }] = await Promise.all([
    supabase
      .from("organisations")
      .select("legal_name, grants_fetched_at")
      .eq("id", identifier.organisation_id)
      .maybeSingle<{ legal_name: string; grants_fetched_at: string | null }>(),
    supabase
      .from("grants")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", identifier.organisation_id),
  ]);
  if (!organisation) return null;

  return {
    organisationId: identifier.organisation_id,
    name: organisation.legal_name,
    grants: organisation.grants_fetched_at
      ? { status: "fetched", count: count ?? 0 }
      : { status: "queued" },
  };
}

async function findListedCompanyByName(name: string): Promise<ListedCompany | null> {
  const supabase = await createClient();
  const { data: organisation, error } = await supabase
    .from("organisations")
    .select("id, legal_name, grants_fetched_at")
    .ilike("legal_name", name.trim())
    .limit(1)
    .maybeSingle<{ id: string; legal_name: string; grants_fetched_at: string | null }>();
  if (error || !organisation) return null;

  const { count } = await supabase
    .from("grants")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", organisation.id);

  return {
    organisationId: organisation.id,
    name: organisation.legal_name,
    grants: organisation.grants_fetched_at
      ? { status: "fetched", count: count ?? 0 }
      : { status: "queued" },
  };
}

/**
 * promotePendingCompaniesHouseRecords already existed but was only ever
 * called from a standalone CLI script (scripts/run-standardize-companies-house.mts),
 * never from anything live — confirmed against staging, 1006 raw
 * companies_house records sat unpromoted. Chaining it in here is what makes
 * a successful import actually show up in the organisations list, not just
 * the raw ingestion queue.
 */
async function promoteAndMergeCounts(
  state: CompaniesHouseImportState,
  actorUserId: string,
): Promise<CompaniesHouseImportState> {
  if (state.kind === "error") return state;

  try {
    const promoted = await promotePendingCompaniesHouseRecords();
    return {
      ...state,
      promoteCounts: {
        inserted: promoted.inserted,
        rejected: promoted.rejected,
        needsReview: promoted.needsReview,
        doesNotMeet: promoted.doesNotMeet,
        failed: promoted.failed,
      },
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_house.promote",
      actorUserId,
    });
    return {
      ...state,
      message: `${state.message} Records were imported but could not be promoted to the organisation list; the failure was recorded.`,
    };
  }
}

/**
 * Step one of two: fetch the company and show what importing it would do,
 * without importing it.
 */
export async function previewCompanyForImport(
  previous: CompanyPreviewState,
  formData: FormData,
): Promise<CompanyPreviewState> {
  void previous;

  const authorization = await getCurrentActor("client:edit");
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const companyNumber = String(formData.get("companyNumber") ?? "").trim();
  const registeredName = String(formData.get("registeredName") ?? "").trim();
  if (!companyNumber && !registeredName) {
    return {
      kind: "error",
      message: "Enter a company number or registered name.",
    };
  }

  const lookup: CompaniesHouseLookup = companyNumber
    ? { companyNumber }
    : { registeredName };

  const result = await previewCompany(
    lookup,
    createDefaultCompanyPreviewDependencies(),
  );

  if (result.status === "not_found") {
    return {
      kind: "error",
      message: companyNumber
        ? "No company on the Companies House register has that company number."
        : "No exact Companies House match was found for that registered name.",
    };
  }
  if (result.status === "unavailable") {
    return { kind: "error", message: result.message };
  }

  return {
    kind: "preview",
    preview: result.preview,
    alreadyListed: await findListedCompany(result.preview.companyNumber),
  };
}

/**
 * Step two of two: import the company the reader has just reviewed.
 */
export async function lookupCompany(
  previous: CompaniesHouseImportState,
  formData: FormData,
): Promise<CompaniesHouseImportState> {
  void previous;

  const authorization = await getCurrentActor("client:edit");
  if (!authorization.ok) {
    return {
      kind: "error",
      message: actorFailureMessage(authorization.reason),
    };
  }

  const companyNumber = String(formData.get("companyNumber") ?? "").trim();
  const registeredName = String(formData.get("registeredName") ?? "").trim();
  if (!companyNumber && !registeredName) {
    return {
      kind: "error",
      message: "Enter a company number or registered name.",
    };
  }

  const lookup: CompaniesHouseLookup = companyNumber
    ? { companyNumber }
    : { registeredName };

  const listedBefore = companyNumber
    ? await findListedCompany(companyNumber)
    : registeredName
      ? await findListedCompanyByName(registeredName)
      : null;

  try {
    const adapter = createCompaniesHouseAdapter(lookup);
    const [summary] = await runIngestion([adapter], {
      triggeredBy: "manual",
      triggeredByUserId: authorization.actor.id,
    });

    if (summary.status === "failed") {
      await reportError(new Error(summary.error ?? "Companies House lookup failed"), {
        operation: "admin.companies_house.lookup",
        source: summary.source,
        actorUserId: authorization.actor.id,
      });
      return importStateFromSummary(summary);
    }

    const promotedState = await promoteAndMergeCounts(
      importStateFromSummary(summary),
      authorization.actor.id,
    );

    const listedAfter = companyNumber
      ? await findListedCompany(companyNumber)
      : registeredName
        ? await findListedCompanyByName(registeredName)
        : null;

    return {
      ...promotedState,
      outcome: companyLookupOutcome(listedBefore, listedAfter, promotedState.promoteCounts),
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_house.lookup",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message:
        "Companies House could not be imported. The failure was recorded; please try again later.",
    };
  }
}

export async function importCompaniesHouse(
  previous: CompaniesHouseImportState,
  formData: FormData,
): Promise<CompaniesHouseImportState> {
  void previous;
  const authorization = await getCurrentActor("client:edit");
  if (!authorization.ok) {
    return {
      kind: "error",
      message: actorFailureMessage(authorization.reason),
    };
  }

  const companyNumber = String(formData.get("companyNumber") ?? "").trim();
  const registeredName = String(formData.get("registeredName") ?? "").trim();
  if (!companyNumber && !registeredName) {
    return {
      kind: "error",
      message: "Enter a company number or registered name.",
    };
  }

  // A company number is authoritative and deliberately wins when both inputs
  // are supplied. Registered-name search is only the agreed fallback.
  const adapter = companyNumber
    ? createCompaniesHouseAdapter({ companyNumber })
    : createCompaniesHouseAdapter({ registeredName });

  try {
    const [summary] = await runIngestion(
      [adapter],
      {
        triggeredBy: "manual",
        triggeredByUserId: authorization.actor.id,
      },
    );

    if (summary.status === "failed") {
      await reportError(new Error(summary.error ?? "Companies House import failed"), {
        operation: "admin.companies_house.import",
        source: summary.source,
        actorUserId: authorization.actor.id,
      });
      return importStateFromSummary(summary);
    }
    return await promoteAndMergeCounts(importStateFromSummary(summary), authorization.actor.id);
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_house.import",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message:
        "Companies House could not be imported. The failure was recorded; please try again later.",
    };
  }
}
