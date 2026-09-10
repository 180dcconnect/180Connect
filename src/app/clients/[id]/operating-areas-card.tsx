"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  ExternalLink,
  Search,
  X,
} from "lucide-react";

import type { OperatingGeography } from "@/lib/operating-geography";
import {
  formatCityWithRegion,
  formatCountryName,
  formatGeographicReach,
} from "@/lib/organisation-format";
import { countryFlagEmoji } from "@/lib/country-flags";
import { Pill, SectionCard } from "./section-card";

const INITIAL_VISIBLE_COUNT = 12;

function mapsUrl(
  city: string | null,
  postcode: string | null,
  country: string,
): string | null {
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
  const [filterQuery, setFilterQuery] = useState("");

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

  const mapLink = mapsUrl(registeredCity, registeredPostcode, registeredCountry);
  const formattedCity = registeredCity ? formatCityWithRegion(registeredCity) : null;
  const formattedCountry = formatCountryName(registeredCountry);

  const filteredLocal = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return localAuthorities;
    return localAuthorities.filter((area) => area.toLowerCase().includes(q));
  }, [localAuthorities, filterQuery]);

  const displayLocal =
    showAllLocal || filterQuery.trim()
      ? filteredLocal
      : filteredLocal.slice(0, INITIAL_VISIBLE_COUNT);

  const remainingLocal = Math.max(
    0,
    filteredLocal.length - INITIAL_VISIBLE_COUNT,
  );

  const displayCountries = showAllCountries
    ? countries
    : countries.slice(0, INITIAL_VISIBLE_COUNT);

  const remainingCountries = Math.max(
    0,
    countries.length - INITIAL_VISIBLE_COUNT,
  );

  return (
    <SectionCard
      headingId="operating-geography-heading"
      title="Operating geography"
      hint={
        totalAreaCount > 0
          ? "Declared statutory delivery areas and registered office location."
          : "Registered legal office and administrative jurisdiction."
      }
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
      <div className="mt-3.5 space-y-4">
        {/* Executive summary grid */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="rounded-inset border border-rule-soft/60 bg-paper/60 p-3">
            <p className="text-[11.5px] font-medium text-dim">Registered office</p>
            <div className="mt-1">
              {mapLink ? (
                <a
                  href={mapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on Google Maps"
                  className="group inline-flex items-center gap-1 font-medium text-lead hover:underline"
                >
                  <span className="truncate text-[13.5px]">
                    {formattedCity || "Not on file"}
                    {registeredPostcode ? ` (${registeredPostcode})` : ""}
                  </span>
                  <ExternalLink
                    aria-hidden="true"
                    className="size-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
                  />
                  <span className="sr-only"> (opens in Google Maps)</span>
                </a>
              ) : (
                <span className="truncate text-[13.5px] font-medium text-ink">
                  {formattedCity || "Not on file"}
                  {registeredPostcode ? ` (${registeredPostcode})` : ""}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {countryFlagEmoji(registeredCountry)
                ? `${countryFlagEmoji(registeredCountry)} `
                : ""}
              {formattedCountry}
            </p>
          </div>

          <div className="rounded-inset border border-rule-soft/60 bg-paper/60 p-3">
            <p className="text-[11.5px] font-medium text-dim">Geographic reach</p>
            <p className="mt-1 text-[13.5px] font-medium text-ink">
              {formatGeographicReach(geographicReach) || (
                <span className="text-faint">Not specified</span>
              )}
            </p>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {geographicReach ? "Statutory operational scope" : "Operating scale"}
            </p>
          </div>

          <div className="rounded-inset border border-rule-soft/60 bg-paper/60 p-3">
            <p className="text-[11.5px] font-medium text-dim">Coverage data source</p>
            <p
              className="mt-1 truncate text-[13.5px] font-medium text-ink"
              title={sourceLabel}
            >
              {sourceLabel}
            </p>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {totalAreaCount > 0
                ? `${totalAreaCount} declared ${totalAreaCount === 1 ? "area" : "areas"} on record`
                : "Official register filing"}
            </p>
          </div>
        </div>

        {/* Operational Areas Listing */}
        {totalAreaCount > 0 ? (
          <div className="space-y-4 pt-1">
            {/* Local Authorities & Cities */}
            {localAuthorities.length > 0 && (
              <div>
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-ink">
                      Local authorities & cities
                    </h4>
                    <span className="rounded-full bg-paper-sunk px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-dim">
                      {filterQuery.trim()
                        ? `${filteredLocal.length} of ${localAuthorities.length}`
                        : localAuthorities.length}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {localAuthorities.length > INITIAL_VISIBLE_COUNT && (
                      <div className="relative">
                        <Search
                          aria-hidden="true"
                          className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-faint"
                        />
                        <input
                          type="text"
                          value={filterQuery}
                          onChange={(e) => setFilterQuery(e.target.value)}
                          placeholder="Filter cities..."
                          aria-label="Filter local authorities and cities"
                          className="w-36 rounded-inset border border-rule-soft bg-white py-0.5 pr-6 pl-7 text-[11.5px] text-ink placeholder:text-faint transition-colors focus:border-lead focus:outline-none sm:w-44"
                        />
                        {filterQuery && (
                          <button
                            type="button"
                            onClick={() => setFilterQuery("")}
                            aria-label="Clear city filter"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-faint transition-colors hover:text-ink cursor-pointer"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </div>
                    )}
                    {localAuthorities.length > INITIAL_VISIBLE_COUNT &&
                      !filterQuery.trim() && (
                        <button
                          type="button"
                          onClick={() => setShowAllLocal(!showAllLocal)}
                          className="text-[11.5px] font-medium text-lead hover:underline cursor-pointer"
                        >
                          {showAllLocal ? "Collapse" : "Show all"}
                        </button>
                      )}
                  </div>
                </div>

                {displayLocal.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {displayLocal.map((area) => (
                      <span
                        key={area}
                        className="inline-flex items-center rounded-inset border border-rule-soft bg-paper/70 px-2.5 py-1 text-[12px] font-medium text-ink"
                      >
                        {area}
                      </span>
                    ))}
                    {!showAllLocal &&
                      !filterQuery.trim() &&
                      remainingLocal > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAllLocal(true)}
                          className="inline-flex items-center rounded-inset border border-dashed border-rule bg-paper/30 px-2 py-1 text-[11.5px] font-medium text-dim transition-colors hover:border-lead hover:text-lead cursor-pointer"
                        >
                          +{remainingLocal} more
                        </button>
                      )}
                  </div>
                ) : (
                  <p className="rounded-inset bg-paper/40 px-3 py-2 text-[12px] text-dim">
                    No declared local authorities match &ldquo;{filterQuery}&rdquo;
                  </p>
                )}
              </div>
            )}

            {/* Regional Scope */}
            {regions.length > 0 && (
              <div
                className={
                  localAuthorities.length > 0
                    ? "border-t border-rule-soft/60 pt-3.5"
                    : ""
                }
              >
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-[13px] font-semibold text-ink">
                    UK regions
                  </h4>
                  <span className="rounded-full bg-paper-sunk px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-dim">
                    {regions.length}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {regions.map((region) => (
                    <span
                      key={region}
                      className="inline-flex items-center rounded-inset border border-rule-soft bg-paper/70 px-2.5 py-1 text-[12px] font-medium text-ink"
                    >
                      {region}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Overseas Operations */}
            {countries.length > 0 && (
              <div
                className={
                  localAuthorities.length > 0 || regions.length > 0
                    ? "border-t border-rule-soft/60 pt-3.5"
                    : ""
                }
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-ink">
                      Overseas operations
                    </h4>
                    <span className="rounded-full bg-paper-sunk px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-dim">
                      {countries.length}
                    </span>
                  </div>
                  {countries.length > INITIAL_VISIBLE_COUNT && (
                    <button
                      type="button"
                      onClick={() => setShowAllCountries(!showAllCountries)}
                      className="text-[11.5px] font-medium text-lead hover:underline cursor-pointer"
                    >
                      {showAllCountries
                        ? "Collapse"
                        : `Show all (${countries.length})`}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {displayCountries.map((country) => {
                    const flag = countryFlagEmoji(country);
                    return (
                      <span
                        key={country}
                        className="inline-flex items-center gap-1.5 rounded-inset border border-rule-soft bg-paper/70 px-2.5 py-1 text-[12px] font-medium text-ink"
                      >
                        {flag && (
                          <span
                            aria-hidden="true"
                            className="text-[13px] leading-none select-none"
                          >
                            {flag}
                          </span>
                        )}
                        {country}
                      </span>
                    );
                  })}
                  {!showAllCountries && remainingCountries > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllCountries(true)}
                      className="inline-flex items-center rounded-inset border border-dashed border-rule bg-paper/30 px-2 py-1 text-[11.5px] font-medium text-dim transition-colors hover:border-lead hover:text-lead cursor-pointer"
                    >
                      +{remainingCountries} more
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Clean single-site / registered office note */
          <div className="rounded-inset border border-rule-soft/60 bg-paper/50 p-3.5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-paper-sunk text-dim">
                <Building2 className="size-3.5" />
              </div>
              <div className="min-w-0 space-y-0.5 text-[12.5px] leading-[1.55]">
                <p className="font-semibold text-ink">
                  {source === "companies_house"
                    ? "Operational delivery areas not reported by Companies House"
                    : "Single-site operation from registered office"}
                </p>
                <p className="text-dim">{sourceDescription}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
