"use server";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { runIngestion } from "@/lib/ingestion/runner";
import {
  createCompaniesHouseAdapter,
  createCompaniesHouseBulkSearchAdapter,
} from "@/lib/ingestion/sources/companieshouse";
import { promotePendingCompaniesHouseRecords } from "@/lib/standardize/write-organisations";
import { importStateFromSummary } from "./import-result";

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
};

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
    // The fetch/import above already succeeded and was already written to
    // raw_source_records — a promotion failure shouldn't be reported as an
    // import failure, just surfaced so the admin knows records are still
    // sitting unpromoted.
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

export async function importCompaniesHouse(
  previous: CompaniesHouseImportState,
  formData: FormData,
): Promise<CompaniesHouseImportState> {
  void previous;
  const authorization = await getCurrentActor("user:manage");
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

export async function importCompaniesHouseBulk(
  previous: CompaniesHouseImportState,
  formData: FormData,
): Promise<CompaniesHouseImportState> {
  void previous;
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return {
      kind: "error",
      message: actorFailureMessage(authorization.reason),
    };
  }

  const sicCodes = String(formData.get("sicCodes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  const location = String(formData.get("location") ?? "").trim();
  const companyStatus = String(formData.get("companyStatus") ?? "").trim();

  if (sicCodes.length === 0 && !location) {
    return {
      kind: "error",
      message: "Enter at least one SIC code or a location to scope the search.",
    };
  }

  const adapter = createCompaniesHouseBulkSearchAdapter({
    sicCodes,
    location: location || undefined,
    companyStatus: companyStatus || undefined,
  });

  try {
    const [summary] = await runIngestion(
      [adapter],
      {
        triggeredBy: "manual",
        triggeredByUserId: authorization.actor.id,
      },
    );

    if (summary.status === "failed") {
      await reportError(new Error(summary.error ?? "Companies House bulk import failed"), {
        operation: "admin.companies_house.bulk_import",
        source: summary.source,
        actorUserId: authorization.actor.id,
      });
      return importStateFromSummary(summary);
    }
    return await promoteAndMergeCounts(importStateFromSummary(summary), authorization.actor.id);
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_house.bulk_import",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message:
        "Companies House could not be imported. The failure was recorded; please try again later.",
    };
  }
}
