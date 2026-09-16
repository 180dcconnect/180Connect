"use client";

import { useId, useState } from "react";
import { Search } from "lucide-react";

import { countryFlagEmoji, countryToIso } from "@/lib/country-flags";
import {
  REGION_ORDER,
  REGION_SHORT,
  regionForIso,
  type WorldRegion,
} from "@/lib/country-regions";
import type { OperatingGeography } from "@/lib/operating-geography";

/**
 * Where the organisation works — section 1.2.
 *
 * **Why this belongs under Scale.** Income says how much money moves through an
 * organisation; reach says how much ground it has to cover with it. A £2m
 * charity working one borough and a £2m charity working forty countries are the
 * same size on paper and completely different to work with.
 *
 * ── What the register actually contains, which is what this is built around ──
 *
 * Measured over the whole file rather than assumed, because the first two
 * versions of this component were designed for a shape the data does not have:
 *
 *   - **Local authorities cap at ten.** 95,200 charities declare exactly one,
 *     16,809 declare two or three, 8,597 declare four to ten, and nothing
 *     declares more. The overwhelmingly common record is a UK charity naming one
 *     or two councils — and for that, an expander, a filter and a counts rail
 *     were three controls wrapped around three words.
 *   - **Countries run to 274.** 12,255 charities declare one; only 1,621 declare
 *     more than twelve. The long list is the rare case, and it is the only case
 *     that needs structure.
 *
 * Two different problems. This solves them separately rather than averaging them
 * into one layout that suits neither.
 *
 * ── Why countries are grouped by region ──
 *
 * Alphabetical is the one order that tells a reader nothing. "Angola, Armenia,
 * Azerbaijan, Bangladesh…" could be an African health charity or a global
 * emergency-response operation, and finding out meant reading all fifty-five
 * names. Grouped, Oxfam reads as 23 African countries, 16 Asian and 8 across
 * Latin America — the actual answer to "where do they operate", available
 * without reading a single name. The names are the detail underneath it.
 *
 * The bar runs largest region first and shades dark to light, so the ramp
 * carries the same information as the lengths rather than decorating them.
 *
 * ── Only the Charity Commission publishes this ──
 *
 * Companies House registers an entity by its registered office and collects no
 * operational areas at all, so a company-only record has nothing here. That is a
 * gap in the registrar, not in our ingestion, and the section says nothing
 * rather than implying the charity works from one address.
 */

/** Above this many areas the names collapse behind a toggle, so the shape stays
 *  readable without a 274-name list pushing sections 2 to 5 off the screen. */
const ALWAYS_SHOWN = 12;
/** Above this, finding one place by eye stops working and a filter appears. */
const FILTER_THRESHOLD = 24;

/** Stands in for a region only if a country ever fails to map. See below. */
const ELSEWHERE = "Elsewhere" as WorldRegion;

/**
 * Region shading: one hue, eight steps, dark to light.
 *
 * A categorical palette would need eight distinguishable hues, and the record's
 * token set has five — three of which (`go`, `hold`, `stop`) carry state meaning
 * and would say a region was good or bad. A sequential ramp says "same kind of
 * thing, different amount", which is what these are; and because the regions are
 * ordered by size, the ramp and the bar lengths agree instead of competing.
 */
const SHADES = [100, 84, 70, 57, 46, 36, 28, 21] as const;
const shade = (index: number) =>
  `color-mix(in oklab, var(--lead) ${SHADES[Math.min(index, SHADES.length - 1)]}%, white)`;

type Group = { region: WorldRegion; names: string[] };

/** Countries bucketed by world region, largest first. */
function groupCountries(countries: readonly string[]): Group[] {
  const buckets = new Map<WorldRegion, string[]>();
  const ungrouped: string[] = [];

  for (const name of countries) {
    const region = regionForIso(countryToIso(name));
    if (!region) {
      ungrouped.push(name);
      continue;
    }
    const bucket = buckets.get(region);
    if (bucket) bucket.push(name);
    else buckets.set(region, [name]);
  }

  const groups = [...buckets.entries()]
    .map(([region, names]) => ({ region, names }))
    .sort(
      (a, b) =>
        b.names.length - a.names.length ||
        REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region),
    );

  // Should never fire — `country-regions.test.ts` holds every register label to
  // a region — but a country silently vanishing from a count would be worse than
  // an honest "Elsewhere".
  if (ungrouped.length > 0) groups.push({ region: ELSEWHERE, names: ungrouped });
  return groups;
}

/** The shape of the list, in a sentence, above the names that justify it. */
function summarise(groups: Group[], total: number): string | null {
  const top = groups[0];
  if (!top || total === 0) return null;
  const label = REGION_SHORT[top.region] ?? top.region;
  if (groups.length === 1) return `All in ${label}.`;
  if (top.names.length / total >= 0.5) {
    return `Mostly ${label}: ${top.names.length} of ${total}.`;
  }
  return `Across ${groups.length} world regions, most in ${label} (${top.names.length}).`;
}

function Names({
  names,
  flags,
}: {
  names: readonly string[];
  /** Country names get a flag; council names do not. */
  flags: boolean;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-5 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
      {names.map((name) => (
        <li
          key={name}
          className="flex min-w-0 items-baseline gap-1.5 text-[12.5px] text-ink"
        >
          {flags && (
            <span aria-hidden="true" className="shrink-0 text-[11px] leading-none">
              {countryFlagEmoji(name) ?? "·"}
            </span>
          )}
          <span className="truncate" title={name}>
            {name}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OperatingReach({ geography }: { geography: OperatingGeography }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filterId = useId();

  const { localAuthorities, regions, countries, totalAreaCount } = geography;

  // A registered office is not a declared area of operation. Where the register
  // published no areas, the overview card explains why in full and this section
  // has nothing to add. After the hooks, so the order never varies.
  if (totalAreaCount === 0) return null;

  const groups = groupCountries(countries);
  const summary = summarise(groups, countries.length);

  const showNames = totalAreaCount <= ALWAYS_SHOWN || open;
  const showFilter = showNames && totalAreaCount > FILTER_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);

  const visibleGroups = groups
    .map((group) => ({ ...group, names: group.names.filter(matches) }))
    .filter((group) => group.names.length > 0);
  const visibleCouncils = localAuthorities.filter(matches);
  const matchCount =
    visibleCouncils.length +
    visibleGroups.reduce((sum, group) => sum + group.names.length, 0);

  // The headline names the kind the charity mostly declares: "3 areas" is
  // vaguer than the register was.
  const abroad = countries.length >= localAuthorities.length;
  const headline = abroad
    ? { count: countries.length, noun: countries.length === 1 ? "country" : "countries" }
    : {
        count: localAuthorities.length,
        noun: localAuthorities.length === 1 ? "local authority" : "local authorities",
      };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <p className="flex items-baseline gap-2">
          <span className="font-mono text-[30px] leading-none font-bold tracking-tight tabular-nums text-ink">
            {headline.count.toLocaleString("en-GB")}
          </span>
          <span className="text-[13px] text-dim">{headline.noun}</span>
          {/* Both kinds declared: the second is said rather than folded into one
              total, which would claim a council and a country are the same unit
              of ground. */}
          {countries.length > 0 && localAuthorities.length > 0 && (
            <span className="text-[13px] text-faint">
              and{" "}
              {abroad
                ? `${localAuthorities.length} UK ${localAuthorities.length === 1 ? "council" : "councils"}`
                : `${countries.length} ${countries.length === 1 ? "country" : "countries"}`}
            </span>
          )}
        </p>

        {summary && countries.length > 1 && (
          <p className="text-[12.5px] text-dim">{summary}</p>
        )}
      </div>

      {/* The scope statements the register files under "Region" are coverage
          claims, not places — "Throughout England And Wales" is not somewhere you
          can point at. Kept as a line rather than counted in with the areas. */}
      {regions.length > 0 && (
        <p className="mt-2 text-[12.5px] text-dim">{regions.join(" · ")}</p>
      )}

      {/* One divided bar rather than a row of small ones: the question is how
          the work splits, and a divided whole answers it as a single object. */}
      {groups.length > 1 && (
        <>
          <div
            className="mt-3.5 flex h-2.5 w-full overflow-hidden rounded-full"
            role="img"
            aria-label={groups
              .map((group) => `${REGION_SHORT[group.region] ?? group.region}: ${group.names.length}`)
              .join(", ")}
          >
            {groups.map((group, index) => (
              <div
                key={group.region}
                title={`${REGION_SHORT[group.region] ?? group.region} — ${group.names.length}`}
                style={{
                  width: `${(group.names.length / countries.length) * 100}%`,
                  background: shade(index),
                }}
              />
            ))}
          </div>

          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {groups.map((group, index) => (
              <li key={group.region} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: shade(index) }}
                />
                <span className="text-[12px] text-dim">
                  {REGION_SHORT[group.region] ?? group.region}
                </span>
                <span className="font-mono text-[12px] font-semibold tabular-nums text-ink">
                  {group.names.length}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {showFilter && (
        <div className="mt-3.5 flex items-center gap-2 rounded-inset border border-rule-soft bg-white px-2.5 py-1.5 focus-within:border-lead-mid">
          <Search aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
          <input
            id={filterId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a place"
            aria-label="Filter declared areas of operation"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
          />
          {needle && (
            <span className="shrink-0 font-mono text-[11.5px] text-faint tabular-nums">
              {matchCount}
            </span>
          )}
        </div>
      )}

      {showNames && (
        <div className="mt-4 space-y-4">
          {needle && matchCount === 0 && (
            <p className="text-[12.5px] text-dim">
              No declared area matches “{query.trim()}”.
            </p>
          )}

          {visibleCouncils.length > 0 && (
            <div>
              {/* A heading only where there is a second list to tell it from. */}
              {visibleGroups.length > 0 && (
                <p className="mb-1.5 text-[11.5px] font-semibold text-dim">
                  UK local authorities
                  <span className="ml-1.5 font-normal text-faint">
                    {visibleCouncils.length}
                  </span>
                </p>
              )}
              <Names names={visibleCouncils} flags={false} />
            </div>
          )}

          {visibleGroups.map((group) => (
            <div key={group.region}>
              {/* Suppressed when every country sits in one region and there is
                  no council list beside it: the summary line has already said
                  which, and a heading over the only list is furniture. */}
              {(groups.length > 1 || visibleCouncils.length > 0) && (
                <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-dim">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{
                      background: shade(
                        groups.findIndex((entry) => entry.region === group.region),
                      ),
                    }}
                  />
                  {group.region}
                  <span className="font-normal text-faint">{group.names.length}</span>
                </p>
              )}
              <Names names={group.names} flags />
            </div>
          ))}
        </div>
      )}

      {totalAreaCount > ALWAYS_SHOWN && (
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
            setQuery("");
          }}
          aria-expanded={open}
          className="mt-3.5 cursor-pointer text-[12.5px] font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid"
        >
          {open ? "Hide the list" : `List all ${totalAreaCount.toLocaleString("en-GB")}`}
        </button>
      )}

      <p className="mt-3 border-t border-rule-soft pt-2.5 text-[11.5px] leading-[1.5] text-faint">
        Declared on the Charity Commission annual return as statutory areas of
        operation: where they say they work, not where they hold offices.
      </p>
    </div>
  );
}
