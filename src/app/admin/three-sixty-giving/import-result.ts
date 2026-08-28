import type { RunSummary } from "@/lib/ingestion/type";
import type { ThreeSixtyGivingImportState } from "./actions";

export function importStateFromSummary(summary: RunSummary): ThreeSixtyGivingImportState {
  const counts = {
    fetched: summary.counts.fetched,
    written: summary.counts.inserted,
    skipped: summary.counts.skipped,
    failed: summary.counts.failed,
  };

  if (summary.status === "failed") {
    // Curated allowlist, same pattern as companies-house/import-result.ts:
    // these come from the lookup adapter's own validation and are safe to
    // show directly. The bulk walk's own failure modes (API errors) aren't
    // in this list, since they aren't actionable by the admin the same way.
    const safeLookupMessages = [
      "Enter a Charity Commission registration number.",
      "Enter a Companies House company number.",
    ];
    return {
      kind: "error",
      message: safeLookupMessages.includes(summary.error ?? "")
        ? summary.error!
        : "360Giving could not be imported. The failure was recorded; please try again later.",
      counts,
    };
  }

  // The bulk walk reported zero organisations to ask about — the pipeline has
  // no uk_charity/uk_company identifiers on record, so the run had literally
  // nothing to walk. That is a no-op, not a success, and the green "imported
  // successfully" line with four zeros hid it. Flag it instead, so the admin
  // knows the fix is upstream (registry identifiers), not a retry.
  if (summary.walkedOrganisations === 0) {
    return {
      kind: "warning",
      message:
        "Nothing to import — the pipeline has no UK charity or company registry " +
        "numbers on record, so there were no organisations to ask about. " +
        "360Giving only attaches grants to charities already known by a registry " +
        "number; run the Companies House / Charity Commission imports first, or " +
        "use the single-org lookup below.",
      counts,
    };
  }

  return {
    kind: summary.status === "partial" ? "warning" : "success",
    message:
      summary.status === "partial"
        ? "The import completed with some records unavailable or invalid."
        : "360Giving data was imported successfully.",
    counts,
  };
}
