// Turns identifiers found on a website into authoritative registry records (F037).
//
// This is the step that decides whether the import is any good. A page scrape is the
// organisation's own marketing copy; a registry record is the legal record. So the
// website is used for what only it has — the mission, the contact inbox, the socials
// — and every field a register also holds is taken from the register instead.
//
// Which register is not a fixed choice, and this is the part of F037 the ticket got
// wrong by assuming charities. 180Connect's clients are charities, non-profits,
// CICs and sustainability-focused companies, and organisation_type has said
// 'charity' | 'cio' | 'cic' | 'social_enterprise' | 'ngo' | 'company' | 'both' |
// 'other' since F041 expansion. A charitable
// company appears on both registers and should be looked up on both. A CIC appears
// only on Companies House. Neither register is the default; what the site prints
// about itself decides.
//
// Both adapters already exist and are used by the scheduled imports —
// createCharityCommissionLookupAdapter (number only) and createCompaniesHouseAdapter
// (number, or exactly one exact name match). This module only decides which to call
// and what to do with the answers.

import type {
  RawCharityCommissionRecord,
} from "../standardize/charity-commission.ts";
import { standardizeCharityCommissionRecord } from "../standardize/charity-commission.ts";
import type { RawCompaniesHouseRecord } from "../standardize/companies-house.ts";
import { standardizeCompaniesHouseRecord } from "../standardize/companies-house.ts";
import type { StandardOrganisation } from "../standardize/types.ts";
import {
  CHARITY_REGISTRY_NAMES,
  type WebsiteExtraction,
} from "./extract-organisation.ts";

export type CompanyLookup = { companyNumber: string } | { registeredName: string };

export type RegistryPlan = {
  charityNumber: string | null;
  company: CompanyLookup | null;
  /**
   * Set when the site names a Scottish or Northern Irish charity number. Those are
   * real registrations on registers this platform has no adapter for, so the number
   * is kept and shown to the CAM, but nothing is looked up against it. Silently
   * dropping it would lose the strongest identifier the page had.
   */
  unsupportedRegister: "scotland" | "northern_ireland" | null;
  unsupportedNumber: string | null;
};

/**
 * Decides which registers to ask, from what the page printed.
 *
 * The name fallback is last and narrow on purpose. Companies House name search
 * already refuses to guess between two exact matches; asking it for a name when the
 * page never claimed to be a registered company invites a confident match on a
 * similarly-named business, which is exactly the failure a CAM cannot spot.
 */
export function planRegistryLookups(extraction: WebsiteExtraction): RegistryPlan {
  const charity = extraction.charity;
  const supportedCharity = charity?.register === "england_and_wales" ? charity.number : null;

  const company: CompanyLookup | null = extraction.companyNumber
    ? { companyNumber: extraction.companyNumber }
    // Only worth a name search when nothing identified the organisation at all.
    // With a charity number in hand the charity register is the better question.
    : !charity && extraction.legalName
      ? { registeredName: extraction.legalName }
      : null;

  return {
    charityNumber: supportedCharity,
    company,
    unsupportedRegister: charity && charity.register !== "england_and_wales"
      ? charity.register
      : null,
    unsupportedNumber: charity && charity.register !== "england_and_wales"
      ? charity.number
      : null,
  };
}

export type RegistryMatch = {
  source: "charity_commission" | "companies_house";
  registryName: string;
  registryNumber: string;
  organisation: StandardOrganisation;
  /** The record as the register returned it, for RAW_SOURCE_RECORDS. */
  rawPayload: unknown;
};

export type RegistryResolution = {
  matches: RegistryMatch[];
  /** Plain sentences for the CAM about what was and was not confirmed (F256). */
  notes: string[];
};

export type RegistryDependencies = {
  lookupCharity: (registeredNumber: string) => Promise<RawCharityCommissionRecord>;
  lookupCompany: (lookup: CompanyLookup) => Promise<
    RawCompaniesHouseRecord & { company_number: string }
  >;
  onFailure?: (error: unknown, context: Record<string, unknown>) => Promise<void> | void;
};

/**
 * Runs the planned lookups, tolerating failure on each independently.
 *
 * A register being down, or not holding the number the footer printed, must not cost
 * the CAM the import — they still get the website's own fields and a sentence saying
 * what could not be confirmed. Both lookups are attempted even when the first fails,
 * because "the charity register was unavailable" says nothing about Companies House.
 */
export async function resolveRegistry(
  extraction: WebsiteExtraction,
  dependencies: RegistryDependencies,
): Promise<RegistryResolution> {
  const plan = planRegistryLookups(extraction);
  const matches: RegistryMatch[] = [];
  const notes: string[] = [];

  if (plan.unsupportedRegister && plan.unsupportedNumber) {
    notes.push(
      plan.unsupportedRegister === "scotland"
        ? `This looks like a Scottish charity (${plan.unsupportedNumber}). 180Connect does not check the Scottish register yet, so its details have not been confirmed.`
        : `This looks like a Northern Irish charity (${plan.unsupportedNumber}). 180Connect does not check that register yet, so its details have not been confirmed.`,
    );
  }

  if (plan.charityNumber) {
    try {
      const record = await dependencies.lookupCharity(plan.charityNumber);
      matches.push({
        source: "charity_commission",
        registryName: CHARITY_REGISTRY_NAMES.england_and_wales,
        registryNumber: String(record.reg_charity_number ?? plan.charityNumber),
        organisation: standardizeCharityCommissionRecord(record),
        rawPayload: record,
      });
    } catch (error) {
      await dependencies.onFailure?.(error, {
        registry: "charity_commission",
        registeredNumber: plan.charityNumber,
      });
      notes.push(
        `The charity number on this website (${plan.charityNumber}) could not be confirmed against the Charity Commission. Check it before submitting.`,
      );
    }
  }

  if (plan.company) {
    try {
      const record = await dependencies.lookupCompany(plan.company);
      matches.push({
        source: "companies_house",
        registryName: "Companies House",
        registryNumber: record.company_number,
        organisation: standardizeCompaniesHouseRecord(record),
        rawPayload: record,
      });
    } catch (error) {
      await dependencies.onFailure?.(error, { registry: "companies_house", ...plan.company });
      notes.push(
        "companyNumber" in plan.company
          ? `The company number on this website (${plan.company.companyNumber}) could not be confirmed against Companies House. Check it before submitting.`
          : "No single Companies House match was found for this organisation's name, so its registration has not been confirmed.",
      );
    }
  }

  return { matches, notes };
}

/**
 * What the confirmed registrations say this organisation is.
 *
 * Returns null when neither register confirmed anything — an unconfirmed guess at
 * organisation_type is worse than an empty dropdown, because F047 gates eligibility
 * on this value and 'charity' waves a record through checks 'company' does not.
 * When only Companies House confirmed, preserve its finer type (cic/cio/social_enterprise)
 * rather than collapsing back to "company".
 */
export function organisationTypeFrom(
  matches: RegistryMatch[],
): "charity" | "cio" | "cic" | "social_enterprise" | "ngo" | "company" | "both" | "other" | null {
  const charity = matches.some((match) => match.source === "charity_commission");
  const companyMatch = matches.find((match) => match.source === "companies_house");
  const company = Boolean(companyMatch);
  if (charity && company) return "both";
  if (charity) return "charity";
  if (companyMatch) {
    const t = companyMatch.organisation.organisation_type;
    // trust the mapper's finer type; fall back to "company" if it returned generic
    if (t === "cic" || t === "cio" || t === "social_enterprise" || t === "ngo" || t === "company") return t;
    return "company";
  }
  if (company) return "company";
  return null;
}
