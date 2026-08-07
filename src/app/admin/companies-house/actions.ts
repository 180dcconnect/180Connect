"use server";

import { reportError } from "@/lib/error-logging";
import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { runIngestion } from "@/lib/ingestion/runner";
import { createCompaniesHouseAdapter } from "@/lib/ingestion/sources/companieshouse";
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
};

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
    return importStateFromSummary(summary);
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
