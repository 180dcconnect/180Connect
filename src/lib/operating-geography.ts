import "server-only";

import { lookupCharityOperatingAreas } from "./charity-register/sqlite.ts";
import type { OrganisationDetailRow } from "./client-basic-info.ts";

export type IdentifierItem = {
  identifier_type: string;
  identifier_value: string;
};

export type SourceItem = {
  source: string;
  source_record_id: string | null;
};

export type OperatingGeography = {
  registeredCity: string | null;
  registeredPostcode: string | null;
  registeredCountry: string;
  geographicReach: string | null;
  source: "charity_commission" | "companies_house" | "registered_office_only" | "manual";
  sourceLabel: string;
  sourceDescription: string;
  localAuthorities: string[];
  regions: string[];
  countries: string[];
  totalAreaCount: number;
};

/**
 * Derives operational areas (cities, local authorities, regions, and overseas countries)
 * for an organisation based on upstream register data.
 *
 * - Charity Commission for England & Wales: extracts declared areas of operation (174 local
 *   authorities, 4 UK regions, 275 foreign countries).
 * - Companies House: reports only the legal registered office; notes that operational delivery
 *   locations are not tracked by the registrar.
 * - Manual Entry: defaults to the registered office address.
 */
export function loadOperatingGeography(
  organisation: OrganisationDetailRow,
  identifiers: readonly IdentifierItem[] = [],
  sources: readonly SourceItem[] = [],
): OperatingGeography {
  const registeredCity = organisation.city?.trim() || null;
  const registeredPostcode = organisation.postcode?.trim() || null;
  const registeredCountry = organisation.country_code || "GB";
  const geographicReach = organisation.geographic_reach ?? null;

  // 1. Look for a UK Charity registration number or Charity Commission source
  const charityIdentifier = identifiers.find(
    (i) => i.identifier_type === "uk_charity" && i.identifier_value?.trim(),
  );
  const charitySource = sources.find(
    (s) =>
      (s.source === "charity_commission" || s.source === "charity_commission_bulk") &&
      s.source_record_id?.trim(),
  );

  const isCharityEntity = Boolean(
    charityIdentifier ||
      charitySource ||
      organisation.organisation_type === "charity" ||
      organisation.organisation_type === "cio" ||
      organisation.organisation_type === "both",
  );

  if (isCharityEntity) {
    const queryCandidate =
      charityIdentifier?.identifier_value ||
      charitySource?.source_record_id ||
      organisation.legal_name;

    const charityAreas = queryCandidate
      ? lookupCharityOperatingAreas(queryCandidate)
      : null;

    if (charityAreas) {
      const totalAreaCount =
        charityAreas.localAuthorities.length +
        charityAreas.regions.length +
        charityAreas.countries.length;

      const sourceDescription =
        totalAreaCount > 0
          ? "Declared in the Charity Commission annual return as statutory areas of operation."
          : "No separate operational areas declared in the Charity Commission return. Operating activity is conducted from the registered office.";

      return {
        registeredCity,
        registeredPostcode,
        registeredCountry,
        geographicReach,
        source: "charity_commission",
        sourceLabel: "Charity Commission for England and Wales",
        sourceDescription,
        localAuthorities: charityAreas.localAuthorities,
        regions: charityAreas.regions,
        countries: charityAreas.countries,
        totalAreaCount,
      };
    }
  }

  // 2. Check if this is a Companies House record
  const isCompaniesHouse =
    sources.some((s) => s.source === "companies_house") ||
    identifiers.some((i) => i.identifier_type === "uk_company");

  if (isCompaniesHouse) {
    return {
      registeredCity,
      registeredPostcode,
      registeredCountry,
      geographicReach,
      source: "companies_house",
      sourceLabel: "Companies House",
      sourceDescription:
        "Companies House registers corporate entities by their registered office. It does not collect or report operational areas, service delivery branches, or trading locations.",
      localAuthorities: [],
      regions: [],
      countries: [],
      totalAreaCount: 0,
    };
  }

  // 3. Check if manual entry
  const isManual = sources.some((s) => s.source === "manual");
  if (isManual) {
    return {
      registeredCity,
      registeredPostcode,
      registeredCountry,
      geographicReach,
      source: "manual",
      sourceLabel: "Manual Entry",
      sourceDescription:
        "Record created via manual entry. Operational reach defaults to the registered office location.",
      localAuthorities: [],
      regions: [],
      countries: [],
      totalAreaCount: 0,
    };
  }

  // 4. Default fallback
  return {
    registeredCity,
    registeredPostcode,
    registeredCountry,
    geographicReach,
    source: "registered_office_only",
    sourceLabel: "Registered Office",
    sourceDescription:
      "Operational areas are not reported. Delivery activity defaults to the registered address.",
    localAuthorities: [],
    regions: [],
    countries: [],
    totalAreaCount: 0,
  };
}
