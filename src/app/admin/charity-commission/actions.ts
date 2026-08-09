"use server";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { runIngestion } from "@/lib/ingestion/runner";
import {
  charityCommissionAdapter,
  createCharityCommissionLookupAdapter,
} from "@/lib/ingestion/sources/charity-commission";
import { importStateFromSummary } from "./import-result";

export type CharityCommissionImportState = {
  kind: "idle" | "success" | "warning" | "error";
  message: string;
  counts?: {
    fetched: number;
    written: number;
    skipped: number;
    failed: number;
  };
};

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

    return importStateFromSummary(summary);
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

    return importStateFromSummary(summary);
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