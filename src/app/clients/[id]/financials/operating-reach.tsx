"use client";

import { useId, useState } from "react";
import { Building2, Compass, Globe, Search } from "lucide-react";

import type { OperatingGeography } from "@/lib/operating-geography";
import { countryFlagEmoji } from "@/lib/country-flags";

/**
 * Where the organisation works, as a measure of scale. Section 1.2.
 *
 * **Why this belongs under Scale and not on its own.** Income says how much
 * money moves through an organisation; reach says how much ground it has to
 * cover with it. A £2m charity working one local authority and a £2m charity
 * working forty are the same size on paper and completely different to work
 * with: the second has coordination problems the first does not, and that is
 * often the project. Neither figure is the whole answer to "how big", which is
 * why they sit in the same section.
 *
 * **Why the whole list is here.** It used to show three names and send the
 * reader to the overview tab for the rest. That had the traffic backwards. This
 * is the tab someone opens to size a client up, and the overview is what they
 * came *from*; bouncing them back out of the page they chose, to read a list,
 * and then expecting them to find their way in again is a worse answer than
 * simply holding the list. So it opens in place, and nothing links away.
 *
 * **Why it starts closed.** A charity may declare up to 174 local authorities,
 * 4 UK regions and 275 foreign countries. Open by default, that pushes every
 * other section off the screen for exactly the clients whose other sections
 * matter most. Closed, the counts carry the scale signal and a sample makes them
 * concrete, which is what a reader skimming actually needs; opening it is one
 * click for the reader who wants to check a particular place.
 *
 * **Why a filter appears on long lists.** Past about thirty entries the reader's
 * question stops being "where do they work" and becomes "do they work *here*",
 * and scanning 174 chips for one name is not a way to answer that.
 *
 * **Only the Charity Commission publishes this.** Companies House registers an
 * entity by its registered office and collects no operational areas at all, so
 * a company-only record has nothing here. That is a gap in the registrar, not
 * in our ingestion, and the section says nothing rather than implying the
 * charity works from one address.
 */

/** Names shown before the list is opened. Enough to read as a sample of a big
 *  list rather than a truncation of a small one, few enough to stay short. */
const NAMES_CLOSED = 12;

/** Above this many areas, scanning stops working and the filter appears. */
const FILTER_THRESHOLD = 30;

/** The three kinds, most specific first: "Camden and Islington" tells a reader
 *  more than "England and Wales". */
const KINDS = [
  {
    key: "localAuthorities",
    singular: "local authority",
    plural: "local authorities",
    heading: "Local authorities",
    Icon: Building2,
  },
  {
    key: "regions",
    singular: "UK region",
    plural: "UK regions",
    heading: "UK regions",
    Icon: Compass,
  },
  {
    key: "countries",
    singular: "country",
    plural: "countries",
    heading: "Countries",
    Icon: Globe,
  },
] as const;

function Chip({ children, flag }: { children: string; flag?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-rule-soft bg-white px-2 py-1 text-[12.5px] leading-none font-medium text-ink">
      {flag && (
        <span aria-hidden="true" className="text-[13.5px] leading-none select-none">
          {flag}
        </span>
      )}
      {children}
    </span>
  );
}

export function OperatingReach({ geography }: { geography: OperatingGeography }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filterId = useId();

  const { totalAreaCount } = geography;

  const present = KINDS.map((kind) => ({ ...kind, names: geography[kind.key] })).filter(
    (kind) => kind.names.length > 0,
  );

  // A registered office is not a declared area of operation. Where the register
  // published no areas, the overview card explains why in full and this section
  // has nothing to add. Checked after the hooks so the order never varies.
  if (totalAreaCount === 0) return null;

  // Already plain names off the register's label table ("Kenya"), not ISO codes:
  // `formatCountryName` is for the registered-office code and would mangle these.
  const sample = present.flatMap((kind) => kind.names).slice(0, NAMES_CLOSED);
  const hidden = totalAreaCount - sample.length;

  const showFilter = open && totalAreaCount > FILTER_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const filtered = present
    .map((kind) => ({
      ...kind,
      matches: needle
        ? kind.names.filter((name) => name.toLowerCase().includes(needle))
        : kind.names,
    }))
    .filter((kind) => kind.matches.length > 0);
  const matchCount = filtered.reduce((total, kind) => total + kind.matches.length, 0);

  return (
    <div className="mt-3.5 overflow-hidden rounded-inset border border-rule-soft bg-paper/50">
      <div className="flex flex-col sm:flex-row">
        {/* The counts. One kind is a single headline figure; a charity that
            declares two or three gets them stacked, which is also the only
            place the split between "at home" and "abroad" is visible. */}
        <div className="flex shrink-0 gap-6 border-b border-rule-soft px-4 py-3.5 sm:min-w-[170px] sm:flex-col sm:gap-3 sm:border-r sm:border-b-0">
          {present.map(({ key, singular, plural, names, Icon }) => (
            <div key={key} className="min-w-0">
              <p className="font-mono text-[26px] leading-none font-bold tracking-tight tabular-nums text-ink">
                {names.length.toLocaleString("en-GB")}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-dim">
                <Icon aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
                {names.length === 1 ? singular : plural}
              </p>
            </div>
          ))}
        </div>

        {/* The names. Chips rather than a comma-joined sentence: at this length
            a sentence is a wall, and a reader scanning for "do they work
            anywhere near us" is looking for one word, not reading prose. */}
        <div className="min-w-0 flex-1 px-4 py-3.5">
          {showFilter && (
            <div className="mb-2.5 flex items-center gap-2 rounded-[5px] border border-rule-soft bg-white px-2 py-1.5 focus-within:border-lead-mid">
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
                <span className="shrink-0 text-[11.5px] tabular-nums text-faint">
                  {matchCount.toLocaleString("en-GB")}
                </span>
              )}
            </div>
          )}

          {!open ? (
            <div className="flex flex-wrap gap-1.5">
              {sample.map((name) => (
                <Chip key={name} flag={countryFlagEmoji(name)}>
                  {name}
                </Chip>
              ))}
            </div>
          ) : needle && matchCount === 0 ? (
            <p className="py-1 text-[12.5px] text-dim">
              No declared area matches “{query.trim()}”.
            </p>
          ) : (
            /* Grouped once opened, because at full length an unlabelled run of
               chips stops saying which of the three lists a name came from, and
               "Kenya" next to "Kensington and Chelsea" is a real ambiguity. A
               charity declaring only one kind gets no headings: there is nothing
               to tell apart, and the count above already names it. */
            <div className={filtered.length > 1 ? "space-y-3" : undefined}>
              {filtered.map(({ key, heading, matches, Icon }) => (
                <div key={key}>
                  {filtered.length > 1 && (
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-dim">
                      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
                      {heading}
                      <span className="font-normal text-faint">
                        {matches.length.toLocaleString("en-GB")}
                      </span>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {matches.map((name) => (
                      <Chip
                        key={name}
                        flag={key === "countries" ? countryFlagEmoji(name) : undefined}
                      >
                        {name}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {hidden > 0 && (
            <button
              type="button"
              onClick={() => {
                setOpen(!open);
                setQuery("");
              }}
              aria-expanded={open}
              className="mt-2.5 cursor-pointer rounded-[5px] text-[12.5px] font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid"
            >
              {open
                ? "Show fewer"
                : `Show all ${totalAreaCount.toLocaleString("en-GB")}`}
            </button>
          )}

          <p className="mt-2.5 text-[11.5px] leading-[1.5] text-faint">
            Declared in the Charity Commission annual return as statutory areas of
            operation: where they say they work, not where they hold offices.
          </p>
        </div>
      </div>
    </div>
  );
}
