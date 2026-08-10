"use server";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { runIngestion } from "@/lib/ingestion/runner";
import { createCompaniesHouseAdapter } from "@/lib/ingestion/sources/companieshouse";
import { runCompaniesHouseDiscoveryImport } from "@/lib/ingestion/sources/companies-house-discovery";
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

/**
 * Zero-input replacement for the old typed-criteria bulk search: runs the same
 * 3-tier mission-fit discovery the weekly cron job runs
 * (companies-house-discovery.ts's runCompaniesHouseDiscoveryImport), so the
 * manual button and the scheduled job can never drift apart. Promotion —
 * including the F047 Tier A/B strong-evidence bypass — happens inside that
 * shared function, not here.
 */
export async function importCompaniesHouseAuto(
  previous: CompaniesHouseImportState,
  formData: FormData,
): Promise<CompaniesHouseImportState> {
  void previous;
  void formData;
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return {
      kind: "error",
      message: actorFailureMessage(authorization.reason),
    };
  }

  try {
    const result = await runCompaniesHouseDiscoveryImport(
      { triggeredBy: "manual", triggeredByUserId: authorization.actor.id },
      authorization.actor.id,
    );

    if (result.summary.status === "failed") {
      await reportError(new Error(result.summary.error ?? "Companies House discovery import failed"), {
        operation: "admin.companies_house.import_auto",
        source: result.summary.source,
        actorUserId: authorization.actor.id,
      });
      return importStateFromSummary(result.summary);
    }

    const state = importStateFromSummary(result.summary);
    if (!result.promoteCounts) {
      return { ...state, message: `${state.message} ${result.promoteError}`.trim() };
    }
    return {
      ...state,
      promoteCounts: {
        inserted: result.promoteCounts.inserted,
        rejected: result.promoteCounts.rejected,
        needsReview: result.promoteCounts.needsReview,
        doesNotMeet: result.promoteCounts.doesNotMeet,
        failed: result.promoteCounts.failed,
      },
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_house.import_auto",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message:
        "Companies House could not be imported. The failure was recorded; please try again later.",
    };
  }
}
