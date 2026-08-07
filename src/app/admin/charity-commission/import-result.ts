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
    // TODO: unlike Companies House, Charity Commission's fetch() doesn't
    // currently produce a curated set of user-safe error strings (no
    // "no exact match" / "invalid number" style messages — those made sense
    // for a single-lookup flow, not a bulk one). Every failure here falls
    // through to the generic message below. If real failure modes (e.g. "API
    // key not set", "date range invalid") turn out to be safe and useful to
    // show admins directly, they should be added to a matching allowlist
    // here, same pattern as import-result.ts in companies-house/.
    return {
      kind: "error",
      message:
        "Charity Commission could not be imported. The failure was recorded; please try again later.",
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