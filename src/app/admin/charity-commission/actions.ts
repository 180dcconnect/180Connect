"use server";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { runIngestion } from "@/lib/ingestion/runner";
import { createCharityCommissionLookupAdapter } from "@/lib/ingestion/sources/charity-commission";
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
 * Ingest, then promote the whole pending backlog.
 *
 * The single-charity lookup is all that remains of the API path: bulk discovery
 * was retired once the staged register covered it (see
 * supabase/migrations/20260915110000_retire_charity_commission_discovery_cron.sql).
 * A named charity is the one case where hitting the API still beats the
 * snapshot — the answer is immediate and needs no refresh.
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

export async function lookupCharity(
  previous: CharityCommissionImportState,
  formData: FormData,
): Promise<CharityCommissionImportState> {
  void previous;

  // client:edit, matching the rest of this screen: a CAM who can shape an
  // import can also look one charity up.
  const authorization = await getCurrentActor("client:edit");
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