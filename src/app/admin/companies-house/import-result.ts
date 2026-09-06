import type { RunSummary } from "@/lib/ingestion/type";
import type { CompaniesHouseImportState } from "./actions";

export type CompanyGrantCoverage =
  | { status: "queued" }
  | { status: "fetched"; count: number };

/** What `findListedCompany` resolves to — the company on the list, or nothing. */
export type ListedCompany = {
  organisationId: string;
  name: string;
  grants: CompanyGrantCoverage;
};

/** Whether the looked-up company is on the client list, and how it got there. */
export type CompanyLookupOutcome =
  | { kind: "added"; organisationId: string; name: string; grants: CompanyGrantCoverage }
  | { kind: "already_listed"; organisationId: string; name: string; grants: CompanyGrantCoverage }
  | { kind: "held_for_review" }
  | { kind: "does_not_meet" }
  | { kind: "not_on_list" };

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

/**
 * Turn the batch counters into the single-company answer, given what was on the
 * list before the run and what is on it after.
 */
export function companyLookupOutcome(
  before: ListedCompany | null,
  after: ListedCompany | null,
  promoted?: CompaniesHouseImportState["promoteCounts"],
): CompanyLookupOutcome {
  if (after) {
    return before
      ? { kind: "already_listed", ...after }
      : { kind: "added", ...after };
  }
  if ((promoted?.needsReview ?? 0) > 0) return { kind: "held_for_review" };
  if ((promoted?.doesNotMeet ?? 0) > 0) return { kind: "does_not_meet" };
  return { kind: "not_on_list" };
}
