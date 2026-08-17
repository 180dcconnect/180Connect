// Shared Charity Commission discovery import (F049) — the one function both the
// manual "Discover new charities" button (src/app/admin/charity-commission/actions.ts)
// and the weekly cron route (src/app/api/cron/charity-commission-import/route.ts)
// call, so the two trigger paths cannot drift apart. Mirrors
// companies-house-discovery.ts / runCompaniesHouseDiscoveryImport.

import { runIngestion } from "../runner.ts";
import type { RunSummary, RunTrigger } from "../type.ts";
import { createCharityCommissionDiscoveryAdapter } from "./charity-commission.ts";
import {
  promotePendingCharityCommissionRecords,
  type PromoteCounts,
} from "../../standardize/write-organisations.ts";
import { sendCharityCommissionDiscoveryDigest } from "../../email/charity-commission-digest.ts";
import { reportError } from "../../error-logging.ts";

export type CharityCommissionDiscoveryResult = {
  summary: RunSummary;
  promoteCounts: PromoteCounts | null;
  /** Set only when the import itself succeeded but promotion then failed — the
   * import is not reported as failed in that case, since records already
   * landed in raw_source_records; this is surfaced so the caller can still
   * tell the admin they're sitting unpromoted. */
  promoteError: string | null;
};

export async function runCharityCommissionDiscoveryImport(
  trigger: RunTrigger,
  actorUserId: string | null = null,
): Promise<CharityCommissionDiscoveryResult> {
  const adapter = createCharityCommissionDiscoveryAdapter();
  const [summary] = await runIngestion([adapter], trigger);

  if (summary.status === "failed") {
    return { summary, promoteCounts: null, promoteError: null };
  }

  try {
    const promoteCounts = await promotePendingCharityCommissionRecords();
    await sendCharityCommissionDiscoveryDigest({
      newOrganisations: promoteCounts.inserted,
      flaggedForReview: promoteCounts.needsReview,
    });
    return { summary, promoteCounts, promoteError: null };
  } catch (error) {
    await reportError(error, {
      operation: "ingestion.charity_commission.discovery.promote",
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
