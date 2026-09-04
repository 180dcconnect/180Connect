// Look before you save: what a single Charity Commission lookup would import,
// resolved without importing anything.
//
// The lookup used to be one irreversible step — type a number, and the charity
// was fetched, written to RAW_SOURCE_RECORDS, promoted into ORGANISATIONS and
// on the client list before anybody had seen its name. There was no point at
// which a reader could say "that is not the charity I meant". This module is
// the half that answers the question; committing stays where it was.
//
// Everything here is derived from the same mappers the promote loop uses
// (standardizeCharityCommissionRecord, charityCommissionIdentifier,
// charityCommissionFinancialPeriod, buildCriteriaInput + checkClientCriteria),
// never a second implementation of those rules. A preview that predicted its
// own answer rather than the importer's would be worse than no preview: it
// would be a promise the import is free to break.
//
// No writes, by construction: the only I/O is the injected fetch. Nothing here
// touches Supabase, so a preview leaves no ingestion run, no raw record and no
// audit trail behind for a charity nobody chose to keep.

import {
  createCharityCommissionLookupAdapter,
} from "../ingestion/sources/charity-commission.ts";
import {
  standardizeCharityCommissionRecord,
  type RawCharityCommissionRecord,
} from "../standardize/charity-commission.ts";
import {
  buildCriteriaInput,
  charityCommissionFinancialPeriod,
  charityCommissionIdentifier,
  type SourceFinancialPeriod,
  type SourceIdentifier,
} from "../standardize/write-organisations.ts";
import { checkClientCriteria, type ClientCriteriaResult } from "../client-criteria.ts";
import type { StandardOrganisation } from "../standardize/types.ts";

/** What the importer would write, plus the verdict it would reach. */
export type CharityPreview = {
  /** Digits as supplied, after the same normalisation the adapter applies. */
  registeredNumber: string;
  /** The ORGANISATIONS row this would become. */
  organisation: StandardOrganisation;
  identifier: SourceIdentifier | null;
  /** The latest filed year, when the detail response carries one. */
  financialPeriod: SourceFinancialPeriod | null;
  /** Whether promotion would add it, hold it for review, or reject it. */
  criteria: ClientCriteriaResult;
  registration: {
    /** "removed" is the one a reader most needs before saving. */
    status: "registered" | "removed";
    registeredOn: string | null;
    removedOn: string | null;
  };
};

export type CharityPreviewResult =
  | { status: "found"; preview: CharityPreview }
  | { status: "not_found" }
  // Upstream was reachable but unhappy, or the number was malformed. The
  // message is already written to be shown to an admin.
  | { status: "unavailable"; message: string };

export type CharityPreviewDependencies = {
  /** Resolves the registration number to one raw record, or null if unknown. */
  fetchRecord: (registeredNumber: string) => Promise<RawCharityCommissionRecord | null>;
};

/** The messages the adapter raises that are safe and useful to show directly. */
const READABLE_FETCH_ERRORS = new Set([
  "Enter a valid Charity Commission registration number.",
  "Charity Commission could not find a charity with that registration number.",
]);

/**
 * Production dependency: the same single-lookup adapter the import runs, called
 * for its `fetch` alone. `runIngestion` is what writes — going around it is the
 * whole point, not a shortcut past a safety check.
 */
export function createDefaultCharityPreviewDependencies(): CharityPreviewDependencies {
  return {
    async fetchRecord(registeredNumber) {
      const { records } = await createCharityCommissionLookupAdapter({
        registeredNumber,
      }).fetch();
      const record = records[0]?.raw_payload as RawCharityCommissionRecord | undefined;
      return record ?? null;
    },
  };
}

/**
 * Fetches one charity and works out what importing it would do. Never throws:
 * a bad number, an unknown charity or an unreachable API all come back as a
 * result the caller can render, the same contract as
 * booklet/generate-booklet.ts's generateBooklet.
 */
export async function previewCharity(
  registeredNumber: string,
  deps: CharityPreviewDependencies,
): Promise<CharityPreviewResult> {
  let raw: RawCharityCommissionRecord | null;
  try {
    raw = await deps.fetchRecord(registeredNumber);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Charity Commission could not find a charity with that registration number.") {
      return { status: "not_found" };
    }
    return {
      status: "unavailable",
      message: READABLE_FETCH_ERRORS.has(message)
        ? message
        : "Charity Commission could not be reached just now. Nothing was changed — try again shortly.",
    };
  }
  if (!raw) return { status: "not_found" };

  const organisation = standardizeCharityCommissionRecord(raw);
  const identifier = charityCommissionIdentifier(raw);

  return {
    status: "found",
    preview: {
      // The identifier the importer derived, not the string that was typed —
      // they differ whenever somebody pads the number, and the one that ends up
      // in ORGANISATION_IDENTIFIERS is the one worth showing and re-submitting.
      registeredNumber: identifier?.identifierValue ?? registeredNumber.trim(),
      organisation,
      identifier,
      financialPeriod: charityCommissionFinancialPeriod(raw),
      criteria: checkClientCriteria(buildCriteriaInput(organisation)),
      registration: {
        status: raw.reg_status === "RM" || raw.date_of_removal ? "removed" : "registered",
        registeredOn: raw.date_of_registration?.slice(0, 10) || null,
        removedOn: raw.date_of_removal?.slice(0, 10) || null,
      },
    },
  };
}
