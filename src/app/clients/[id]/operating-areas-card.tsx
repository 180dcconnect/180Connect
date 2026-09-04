"use client";

import { useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Compass,
  ExternalLink,
  Globe,
  Info,
  MapPin,
} from "lucide-react";

import type { OperatingGeography } from "@/lib/operating-geography";
import {
  formatCityWithRegion,
  formatCountryName,
  formatGeographicReach,
} from "@/lib/organisation-format";
import { Pill, SectionCard } from "./section-card";

const INITIAL_VISIBLE_COUNT = 12;

function mapsUrl(city: string | null, postcode: string | null, country: string): string | null {
  const query = [city, postcode, country].filter(Boolean).join(", ");
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function OperatingAreasCard({
  geography,
}: {
  geography: OperatingGeography;
}) {
  const [showAllLocal, setShowAllLocal] = useState(false);
  const [showAllCountries, setShowAllCountries] = useState(false);

  const {
    registeredCity,
    registeredPostcode,
    registeredCountry,
    geographicReach,
    source,
    sourceLabel,
    sourceDescription,
    localAuthorities,
    regions,
    countries,
    totalAreaCount,
  } = geography;

  const visibleLocal = showAllLocal
    ? localAuthorities
    : localAuthorities.slice(0, INITIAL_VISIBLE_COUNT);
  const remainingLocal = localAuthorities.length - INITIAL_VISIBLE_COUNT;

  const visibleCountries = showAllCountries
    ? countries
    : countries.slice(0, INITIAL_VISIBLE_COUNT);
  const remainingCountries = countries.length - INITIAL_VISIBLE_COUNT;

  const mapLink = mapsUrl(registeredCity, registeredPostcode, registeredCountry);

  const formattedCity = registeredCity ? formatCityWithRegion(registeredCity) : null;
  const formattedCountry = formatCountryName(registeredCountry);

  return (
    <SectionCard
      headingId="operating-geography-heading"
      title="Operating Geography"
      icon={<MapPin className="size-[15px]" />}
      action={
        totalAreaCount > 0 ? (
          <Pill tone="go">
            {totalAreaCount} declared {totalAreaCount === 1 ? "area" : "areas"}
          </Pill>
        ) : source === "companies_house" ? (
          <Pill tone="neutral">Registered office only</Pill>
        ) : geographicReach ? (
          <Pill tone="lead">{formatGeographicReach(geographicReach)}</Pill>
        ) : (
          <Pill tone="neutral">Registered office</Pill>
        )
      }
    >
      <div className="mt-3.5 space-y-4 text-ink">
        {/* Metadata summary grid */}
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-rule-soft bg-[#fafafa] p-3 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-dim">
              <MapPin className="size-3.5 text-faint" />
              Registered Office
            </p>
            <p className="mt-1 font-medium text-ink">
              {mapLink ? (
                <a
                  href={mapLink}
                  target="_blank"
                  rel="noreferrer"
                  title="View on Google Maps"
                  className="group inline-flex items-center gap-1 text-lead hover:underline"
                >
                  <span className="truncate">
                    {formattedCity || "Not on file"}
                    {registeredPostcode ? ` (${registeredPostcode})` : ""}
                  </span>
                  <ExternalLink className="size-3 opacity-60 group-hover:opacity-100" />
                </a>
              ) : (
                <span>{formattedCity || "Not on file"}</span>
              )}
            </p>
            <p className="text-[12px] text-faint">{formattedCountry}</p>
          </div>

          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-dim">
              <Compass className="size-3.5 text-faint" />
              Geographic Reach
            </p>
            <p className="mt-1 font-medium text-ink">
              {formatGeographicReach(geographicReach) || (
                <span className="text-faint">Not specified</span>
              )}
            </p>
            <p className="text-[12px] text-faint">Operational scale</p>
          </div>

          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-dim">
              <Globe className="size-3.5 text-faint" />
              Data Source
            </p>
            <p className="mt-1 truncate font-medium text-ink" title={sourceLabel}>
              {sourceLabel}
            </p>
            <p className="text-[12px] text-faint">Official register filing</p>
          </div>
        </div>

        {/* Operational Areas Listing */}
        {totalAreaCount > 0 ? (
          <div className="space-y-4 pt-1">
            {/* Local Authorities & Cities */}
            {localAuthorities.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                    <Building2 className="size-3.5 text-faint" />
                    Cities & Local Authorities
                    <span className="text-[12px] font-normal text-dim">
                      ({localAuthorities.length})
                    </span>
                  </h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {visibleLocal.map((area) => (
                    <span
                      key={area}
                      className="inline-flex items-center gap-1 rounded-md border border-rule-soft bg-rule-subtle px-2.5 py-1 text-[12.5px] font-medium text-ink transition-colors hover:bg-black/[0.04]"
                    >
                      <MapPin className="size-3 text-faint" />
                      {area}
                    </span>
                  ))}
                </div>
                {localAuthorities.length > INITIAL_VISIBLE_COUNT && (
                  <button
                    type="button"
                    onClick={() => setShowAllLocal(!showAllLocal)}
                    className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium text-lead hover:underline"
                  >
                    {showAllLocal ? (
                      <>
                        <ChevronUp className="size-3.5" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-3.5" />
                        Show {remainingLocal} more cities / authorities
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Regions */}
            {regions.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <Compass className="size-3.5 text-faint" />
                  Regional Scope
                  <span className="text-[12px] font-normal text-dim">
                    ({regions.length})
                  </span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {regions.map((region) => (
                    <span
                      key={region}
                      className="inline-flex items-center gap-1 rounded-md border border-rule-soft bg-rule-subtle px-2.5 py-1 text-[12.5px] font-medium text-ink transition-colors hover:bg-black/[0.04]"
                    >
                      <Compass className="size-3 text-faint" />
                      {region}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Overseas Countries */}
            {countries.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                    <Globe className="size-3.5 text-faint" />
                    Countries Operated In Abroad
                    <span className="text-[12px] font-normal text-dim">
                      ({countries.length})
                    </span>
                  </h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {visibleCountries.map((country) => (
                    <span
                      key={country}
                      className="inline-flex items-center gap-1 rounded-md border border-rule-soft bg-rule-subtle px-2.5 py-1 text-[12.5px] font-medium text-ink transition-colors hover:bg-black/[0.04]"
                    >
                      <Globe className="size-3 text-faint" />
                      {country}
                    </span>
                  ))}
                </div>
                {countries.length > INITIAL_VISIBLE_COUNT && (
                  <button
                    type="button"
                    onClick={() => setShowAllCountries(!showAllCountries)}
                    className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium text-lead hover:underline"
                  >
                    {showAllCountries ? (
                      <>
                        <ChevronUp className="size-3.5" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-3.5" />
                        Show {remainingCountries} more countries
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Empty state notice */
          <div className="flex items-start gap-3 rounded-lg border border-rule-soft bg-[#fafafa] p-3.5">
            <Info className="mt-0.5 size-4 shrink-0 text-faint" />
            <div className="text-xs leading-relaxed text-dim">
              <p className="font-semibold text-ink">
                {source === "companies_house"
                  ? "Operational areas not reported by Companies House"
                  : source === "charity_commission"
                    ? "Registered office operation"
                    : "Registered office operation"}
              </p>
              <p className="mt-1">{sourceDescription}</p>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
