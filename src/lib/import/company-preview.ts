// Look before you save: what a single Companies House lookup would import,
// resolved without importing anything.
//
// The lookup used to be one irreversible step — type a number or name, and the
// company was fetched, written to RAW_SOURCE_RECORDS, promoted into ORGANISATIONS
// and on the client list before anybody had seen its details. This module is the
// half that answers the question; committing stays where it was.
//
// Everything here is derived from the same mappers the promote loop uses
// (standardizeCompaniesHouseRecord, companiesHouseIdentifier,
// classifyCompaniesHouseTier, classifyCompaniesHouseSourceConfidence,
// buildCriteriaInput + checkClientCriteria), never a second implementation.
//
// No writes, by construction: the only I/O is the injected fetch. Nothing here
// touches Supabase, so a preview leaves no ingestion run, no raw record and no
// audit trail behind for a company nobody chose to keep.

import {
  createCompaniesHouseAdapter,
  normalizeCompanyNumber,
  type CompaniesHouseLookup,
} from "../ingestion/sources/companieshouse.ts";
import {
  standardizeCompaniesHouseRecord,
  classifyCompaniesHouseSourceConfidence,
  type RawCompaniesHouseRecord,
} from "../standardize/companies-house.ts";
import {
  classifyCompaniesHouseTier,
  type CompaniesHouseTier,
} from "../ingestion/sources/companies-house-criteria-config.ts";
import {
  buildCriteriaInput,
  companiesHouseIdentifier,
  type SourceIdentifier,
} from "../standardize/write-organisations.ts";
import { checkClientCriteria, type ClientCriteriaResult } from "../client-criteria.ts";
import type { StandardOrganisation } from "../standardize/types.ts";

export type CompanyProfilePayload = RawCompaniesHouseRecord & {
  company_number?: string;
  date_of_creation?: string;
  date_of_cessation?: string;
};

/** What the importer would write, plus the verdict it would reach. */
export type CompanyPreview = {
  /** The normalized company number, e.g. "09668396". */
  companyNumber: string;
  /** The ORGANISATIONS row this would become. */
  organisation: StandardOrganisation;
  identifier: SourceIdentifier | null;
  /** Whether promotion would add it, hold it for review, or reject it. */
  criteria: ClientCriteriaResult;
  sourceConfidence: "strong" | "weak";
  tier: CompaniesHouseTier | null;
  registration: {
    status: string;
    isActive: boolean;
    incorporatedOn: string | null;
    dissolvedOn: string | null;
  };
  sicCodes: string[];
  companyType: string | null;
  companySubtype: string | null;
};

export type CompanyPreviewResult =
  | { status: "found"; preview: CompanyPreview }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

export type CompanyPreviewDependencies = {
  /** Resolves the lookup to the company profile and normalized company number. */
  fetchRecord: (
    lookup: CompaniesHouseLookup,
  ) => Promise<{ record: CompanyProfilePayload; companyNumber: string } | null>;
};

const READABLE_FETCH_ERRORS = new Set([
  "Enter a company number or registered name.",
  "Enter a registered name.",
  "Enter a valid Companies House company number.",
  "More than one exact Companies House match was found; use a company number.",
  "No exact Companies House match was found for that registered name.",
  "Companies House could not find that company number.",
]);

export function createDefaultCompanyPreviewDependencies(): CompanyPreviewDependencies {
  return {
    async fetchRecord(lookup) {
      const { records } = await createCompaniesHouseAdapter(lookup).fetch();
      const first = records[0];
      if (!first) return null;
      const raw = first.raw_payload as CompanyProfilePayload;
      return {
        record: raw,
        companyNumber: first.source_record_id,
      };
    },
  };
}

export async function previewCompany(
  lookup: CompaniesHouseLookup,
  deps: CompanyPreviewDependencies,
): Promise<CompanyPreviewResult> {
  let result: { record: CompanyProfilePayload; companyNumber: string } | null;
  try {
    result = await deps.fetchRecord(lookup);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message === "Companies House could not find that company number." ||
      message === "No exact Companies House match was found for that registered name."
    ) {
      return { status: "not_found" };
    }
    return {
      status: "unavailable",
      message: READABLE_FETCH_ERRORS.has(message)
        ? message
        : "Companies House could not be reached just now. Nothing was changed — try again shortly.",
    };
  }
  if (!result || !result.record) return { status: "not_found" };

  const { record: raw, companyNumber } = result;
  const organisation = standardizeCompaniesHouseRecord(raw);
  const identifier = companiesHouseIdentifier(companyNumber);
  const sourceConfidence = classifyCompaniesHouseSourceConfidence(raw);
  const tier = classifyCompaniesHouseTier(raw);
  const criteria = checkClientCriteria({
    ...buildCriteriaInput(organisation),
    sourceConfidence,
  });

  const status = (raw.company_status ?? "unknown").toLowerCase();
  const isActive = status === "active";

  return {
    status: "found",
    preview: {
      companyNumber: normalizeCompanyNumber(companyNumber),
      organisation,
      identifier,
      criteria,
      sourceConfidence,
      tier,
      registration: {
        status,
        isActive,
        incorporatedOn: raw.date_of_creation ? raw.date_of_creation.slice(0, 10) : null,
        dissolvedOn: raw.date_of_cessation ? raw.date_of_cessation.slice(0, 10) : null,
      },
      sicCodes: Array.isArray(raw.sic_codes)
        ? raw.sic_codes.filter((c): c is string => typeof c === "string")
        : [],
      companyType: typeof raw.company_type === "string" ? raw.company_type : null,
      companySubtype: typeof raw.company_subtype === "string" ? raw.company_subtype : null,
    },
  };
}
