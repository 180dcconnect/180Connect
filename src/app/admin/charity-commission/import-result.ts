import type { RunSummary } from "@/lib/ingestion/type";
import type { PromoteCounts } from "@/lib/standardize/write-organisations";
import type { CharityCommissionImportState } from "./actions";

/**
 * F049: a human-readable sentence for what happened during the promote step
 * (raw_source_records -> organisations), appended after the ingestion
 * message. Charity Commission records map to organisation_type "charity",
 * which F047's criteria config treats as acceptedOrganisationTypes, so most
 * successful lookups here should show up as "added", unlike Companies House.
 */
export function describePromotion(counts: PromoteCounts): string {
  if (counts.read === 0) return "Nothing was waiting to be added to the client list.";

  const parts: string[] = [];
  if (counts.inserted > 0) parts.push(`${counts.inserted} added to the client list`);
  if (counts.needsReview > 0) parts.push(`${counts.needsReview} flagged for review`);
  if (counts.doesNotMeet > 0) parts.push(`${counts.doesNotMeet} did not meet the client criteria`);
  if (counts.invalidData > 0) parts.push(`${counts.invalidData} had no usable name`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed to write`);

  return parts.length > 0 ? `${parts.join(", ")}.` : "Nothing new to add.";
}

export function importStateFromSummary(
  summary: RunSummary,
): CharityCommissionImportState {
  const counts = {
    fetched: summary.counts.fetched,
    written: summary.counts.inserted,
    skipped: summary.counts.skipped,
    failed: summary.counts.failed,
  };

  if (summary.status === "failed") {
    // Curated allowlist, same pattern as import-result.ts in companies-house/:
    // these come from createCharityCommissionLookupAdapter's single-lookup
    // path and are safe/useful to show directly. The bulk backfill's own
    // failure modes (API errors, malformed responses) aren't in this list —
    // those still fall through to the generic message below, since they
    // aren't actionable by the admin the way "you typed a bad number" is.
    const safeLookupMessages = [
      "Enter a valid Charity Commission registration number.",
      "Charity Commission could not find a charity with that registration number.",
    ];
    return {
      kind: "error",
      message: safeLookupMessages.includes(summary.error ?? "")
        ? summary.error!
        : "Charity Commission could not be imported. The failure was recorded; please try again later.",
      counts,
    };
  }

  return {
    kind: summary.status === "partial" ? "warning" : "success",
    message:
      summary.status === "partial"
        ? "The import completed with some records unavailable or invalid."
        : "Charity Commission data was imported successfully.",
    counts,
  };
}