// Shared Companies House discovery import — the one function both the manual
// "Import" button (src/app/admin/companies-house/actions.ts) and the weekly cron
// route (src/app/api/cron/companies-house-import/route.ts) call, so the two
// trigger paths cannot drift apart.

import { runIngestion } from "../runner.ts";
import type { RunSummary, RunTrigger } from "../type.ts";
import { createCompaniesHouseDiscoveryAdapter } from "./companieshouse.ts";
import {
  promotePendingCompaniesHouseRecords,
  type PromoteCounts,
} from "../../standardize/write-organisations.ts";
import { sendCompaniesHouseDiscoveryDigest } from "../../email/companies-house-digest.ts";
import { reportError } from "../../error-logging.ts";

export type CompaniesHouseDiscoveryResult = {
  summary: RunSummary;
  promoteCounts: PromoteCounts | null;
  /** Set only when the import itself succeeded but promotion then failed — the
   * import is not reported as failed in that case, since records already
   * landed in raw_source_records; this is surfaced so the caller can still
   * tell the admin they're sitting unpromoted. */
  promoteError: string | null;
};

export async function runCompaniesHouseDiscoveryImport(
  trigger: RunTrigger,
  actorUserId: string | null = null,
): Promise<CompaniesHouseDiscoveryResult> {
  const adapter = createCompaniesHouseDiscoveryAdapter();
  const [summary] = await runIngestion([adapter], trigger);

  if (summary.status === "failed") {
    return { summary, promoteCounts: null, promoteError: null };
  }

  try {
    const promoteCounts = await promotePendingCompaniesHouseRecords();
    await sendCompaniesHouseDiscoveryDigest({
      newOrganisations: promoteCounts.inserted,
      flaggedForReview: promoteCounts.needsReview,
    });
    return { summary, promoteCounts, promoteError: null };
  } catch (error) {
    await reportError(error, {
      operation: "ingestion.companies_house.discovery.promote",
      actorUserId,
    });
    return {
      summary,
      promoteCounts: null,
      promoteError:
        "Records were imported but could not be promoted to the organisation list; the failure was recorded.",
    };
  }
}
