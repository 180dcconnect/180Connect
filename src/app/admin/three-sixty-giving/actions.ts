"use server";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { runIngestion } from "@/lib/ingestion/runner";
import {
  createThreeSixtyGivingAdapter,
  createThreeSixtyGivingLookupAdapter,
} from "@/lib/ingestion/sources/threesixtygiving";
import { promotePendingThreeSixtyGivingRecords } from "@/lib/standardize/three-sixty-giving";
import { importStateFromSummary } from "./import-result";

export type ThreeSixtyGivingImportState = {
  kind: "idle" | "success" | "warning" | "error";
  message: string;
  counts?: {
    fetched: number;
    written: number;
    skipped: number;
    failed: number;
  };
  promoteCounts?: {
    matched: number;
    unmatched: number;
    invalidData: number;
    failed: number;
  };
};

/**
 * Chains matching straight after fetch, same fix companies-house/actions.ts
 * applied (promotePendingCompaniesHouseRecords used to only ever run from a
 * standalone script, so a successful import never showed up anywhere) — not
 * repeating that gap here on a brand-new source.
 */
async function promoteAndMergeCounts(
  state: ThreeSixtyGivingImportState,
  actorUserId: string,
): Promise<ThreeSixtyGivingImportState> {
  if (state.kind === "error") return state;

  try {
    const promoted = await promotePendingThreeSixtyGivingRecords();
    return {
      ...state,
      promoteCounts: {
        matched: promoted.matched,
        unmatched: promoted.unmatched,
        invalidData: promoted.invalidData,
        failed: promoted.failed,
      },
    };
  } catch (error) {
    // The fetch above already succeeded and is already in raw_source_records
    // — a matching failure shouldn't be reported as an import failure, just
    // surfaced so the admin knows records are still sitting unmatched.
    await reportError(error, {
      operation: "admin.three_sixty_giving.promote",
      actorUserId,
    });
    return {
      ...state,
      message: `${state.message} Records were imported but could not be matched to a charity; the failure was recorded.`,
    };
  }
}

export async function importThreeSixtyGiving(
  previous: ThreeSixtyGivingImportState,
  formData: FormData,
): Promise<ThreeSixtyGivingImportState> {
  void previous;
  void formData; // no inputs — this walks every known charity/company identifier

  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  try {
    const [summary] = await runIngestion(
      [createThreeSixtyGivingAdapter()],
      { triggeredBy: "manual", triggeredByUserId: authorization.actor.id },
    );

    if (summary.status === "failed") {
      await reportError(new Error(summary.error ?? "360Giving import failed"), {
        operation: "admin.three_sixty_giving.import",
        source: summary.source,
        actorUserId: authorization.actor.id,
      });
      return importStateFromSummary(summary);
    }

    return await promoteAndMergeCounts(importStateFromSummary(summary), authorization.actor.id);
  } catch (error) {
    await reportError(error, {
      operation: "admin.three_sixty_giving.import",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message: "360Giving could not be imported. The failure was recorded; please try again later.",
    };
  }
}

export async function lookupThreeSixtyGivingGrants(
  previous: ThreeSixtyGivingImportState,
  formData: FormData,
): Promise<ThreeSixtyGivingImportState> {
  void previous;

  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const charityNumber = String(formData.get("charityNumber") ?? "").trim();
  const companyNumber = String(formData.get("companyNumber") ?? "").trim();
  if (!charityNumber && !companyNumber) {
    return { kind: "error", message: "Enter a charity number or company number." };
  }

  // Charity number wins when both are supplied — same precedence rule as
  // Companies House's number-vs-name lookup, for the same reason: it's the
  // more specific, authoritative identifier.
  const adapter = charityNumber
    ? createThreeSixtyGivingLookupAdapter({ charityNumber })
    : createThreeSixtyGivingLookupAdapter({ companyNumber });

  try {
    const [summary] = await runIngestion(
      [adapter],
      { triggeredBy: "manual", triggeredByUserId: authorization.actor.id },
    );

    if (summary.status === "failed") {
      await reportError(new Error(summary.error ?? "360Giving lookup failed"), {
        operation: "admin.three_sixty_giving.lookup",
        source: summary.source,
        actorUserId: authorization.actor.id,
      });
      return importStateFromSummary(summary);
    }

    return await promoteAndMergeCounts(importStateFromSummary(summary), authorization.actor.id);
  } catch (error) {
    await reportError(error, {
      operation: "admin.three_sixty_giving.lookup",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message: "360Giving could not be imported. The failure was recorded; please try again later.",
    };
  }
}
