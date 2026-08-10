import type { RunSummary } from "@/lib/ingestion/type";
import type { CharityCommissionImportState } from "./actions";

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