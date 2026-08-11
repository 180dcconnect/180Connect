import type { RunSummary } from "@/lib/ingestion/type";
import type { CompaniesHouseImportState } from "./actions";

export function importStateFromSummary(
  summary: RunSummary,
): CompaniesHouseImportState {
  const counts = {
    fetched: summary.counts.fetched,
    written: summary.counts.inserted,
    skipped: summary.counts.skipped,
    failed: summary.counts.failed,
  };

  if (summary.status === "failed") {
    const safeLookupMessages = [
      "No exact Companies House match was found for that registered name.",
      "More than one exact Companies House match was found; use a company number.",
      "Companies House could not find that company number.",
      "Enter a valid Companies House company number.",
    ];
    return {
      kind: "error",
      message: safeLookupMessages.includes(summary.error ?? "")
        ? summary.error!
        : "Companies House could not be imported. The failure was recorded; please try again later.",
      counts,
    };
  }

  return {
    kind: summary.status === "partial" ? "warning" : "success",
    message:
      summary.status === "partial"
        ? "The import completed with some records unavailable or invalid."
        : "Companies House data was imported successfully.",
    counts,
  };
}
