"use server";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { runIngestion } from "@/lib/ingestion/runner";
import {
  charityCommissionAdapter,
  createCharityCommissionLookupAdapter,
} from "@/lib/ingestion/sources/charity-commission";
import { runCharityCommissionDiscoveryImport } from "@/lib/ingestion/sources/charity-commission-discovery";
import { promotePendingCharityCommissionRecords } from "@/lib/standardize/write-organisations";
import { importStateFromSummary, describePromotion } from "./import-result";

export type CharityCommissionImportState = {
  kind: "idle" | "success" | "warning" | "error";
  message: string;
  counts?: {
    fetched: number;
    written: number;
    skipped: number;
    failed: number;
  };
  promoted?: {
    inserted: number;
    needsReview: number;
    doesNotMeet: number;
    invalidData: number;
    failed: number;
  };
};

/**
 * F049: shared by both the bulk trigger and the single lookup below - each
 * only differs in which adapter it runs, both need the same "ingest, then
 * promote the whole pending backlog" chaining afterward.
 */
async function withPromotion(
  ingestState: CharityCommissionImportState,
  actorUserId: string,
  operation: string,
): Promise<CharityCommissionImportState> {
  try {
    const promoteCounts = await promotePendingCharityCommissionRecords();
    return {
      ...ingestState,
      message: `${ingestState.message} ${describePromotion(promoteCounts)}`,
      promoted: {
        inserted: promoteCounts.inserted,
        needsReview: promoteCounts.needsReview,
        doesNotMeet: promoteCounts.doesNotMeet,
        invalidData: promoteCounts.invalidData,
        failed: promoteCounts.failed,
      },
    };
  } catch (promoteError) {
    await reportError(promoteError, { operation, actorUserId });
    return {
      ...ingestState,
      message: `${ingestState.message} The data was imported, but could not be promoted into the client list - it will be picked up on the next run.`,
    };
  }
}

export async function importCharityCommission(
  previous: CharityCommissionImportState,
  formData: FormData,
): Promise<CharityCommissionImportState> {
  void previous;
  void formData; // no inputs — this is a bulk trigger, not a single lookup

  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return {
      kind: "error",
      message: actorFailureMessage(authorization.reason),
    };
  }

  try {
    const [summary] = await runIngestion(
      [charityCommissionAdapter],
      {
        triggeredBy: "manual",
        triggeredByUserId: authorization.actor.id,
      },
    );

    if (summary.status === "failed") {
      await reportError(new Error(summary.error ?? "Charity Commission import failed"), {
        operation: "admin.charity_commission.import",
        source: summary.source,
        actorUserId: authorization.actor.id,
      });
      return importStateFromSummary(summary);
    }

    return withPromotion(
      importStateFromSummary(summary),
      authorization.actor.id,
      "admin.charity_commission.promote",
    );
  } catch (error) {
    await reportError(error, {
      operation: "admin.charity_commission.import",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message:
        "Charity Commission could not be imported. The failure was recorded; please try again later.",
    };
  }
}

/**
 * Zero-input discovery (F049): searches from the latest already-ingested
 * registration date to today, rather than a bulk backfill's fixed date range.
 * Runs the same function the weekly cron job runs
 * (charity-commission-discovery.ts's runCharityCommissionDiscoveryImport), so the
 * manual button and the scheduled job can never drift apart. Promotion happens
 * inside that shared function, not here — unlike importCharityCommission and
 * lookupCharity above, which call withPromotion separately because their bare
 * adapters (charityCommissionAdapter, createCharityCommissionLookupAdapter) don't
 * promote on their own. Mirrors companies-house/actions.ts's
 * importCompaniesHouseAuto.
 */
export async function importCharityCommissionAuto(
  previous: CharityCommissionImportState,
  formData: FormData,
): Promise<CharityCommissionImportState> {
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
    const result = await runCharityCommissionDiscoveryImport(
      { triggeredBy: "manual", triggeredByUserId: authorization.actor.id },
      authorization.actor.id,
    );

    if (result.summary.status === "failed") {
      await reportError(new Error(result.summary.error ?? "Charity Commission discovery import failed"), {
        operation: "admin.charity_commission.import_auto",
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
      message: `${state.message} ${describePromotion(result.promoteCounts)}`,
      promoted: {
        inserted: result.promoteCounts.inserted,
        needsReview: result.promoteCounts.needsReview,
        doesNotMeet: result.promoteCounts.doesNotMeet,
        invalidData: result.promoteCounts.invalidData,
        failed: result.promoteCounts.failed,
      },
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.charity_commission.import_auto",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message:
        "Charity Commission could not be imported. The failure was recorded; please try again later.",
    };
  }
}

export async function lookupCharity(
  previous: CharityCommissionImportState,
  formData: FormData,
): Promise<CharityCommissionImportState> {
  void previous;

  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return {
      kind: "error",
      message: actorFailureMessage(authorization.reason),
    };
  }

  const registeredNumber = String(formData.get("registeredNumber") ?? "").trim();
  if (!registeredNumber) {
    return {
      kind: "error",
      message: "Enter a Charity Commission registration number.",
    };
  }

  try {
    const [summary] = await runIngestion(
      [createCharityCommissionLookupAdapter({ registeredNumber })],
      {
        triggeredBy: "manual",
        triggeredByUserId: authorization.actor.id,
      },
    );

    if (summary.status === "failed") {
      await reportError(new Error(summary.error ?? "Charity Commission lookup failed"), {
        operation: "admin.charity_commission.lookup",
        source: summary.source,
        actorUserId: authorization.actor.id,
      });
      return importStateFromSummary(summary);
    }

    return withPromotion(
      importStateFromSummary(summary),
      authorization.actor.id,
      "admin.charity_commission.promote",
    );
  } catch (error) {
    await reportError(error, {
      operation: "admin.charity_commission.lookup",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message:
        "Charity Commission could not be imported. The failure was recorded; please try again later.",
    };
  }
}