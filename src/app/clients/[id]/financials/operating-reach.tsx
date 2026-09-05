import Link from "next/link";
import { MapPin } from "lucide-react";

import type { OperatingGeography } from "@/lib/operating-geography";

/**
 * How far the organisation reaches, as a measure of scale.
 *
 * **Why this belongs under Scale and not on its own.** Income says how much
 * money moves through an organisation; reach says how much ground it has to
 * cover with it. A £2m charity working one local authority and a £2m charity
 * working forty are the same size on paper and completely different to work
 * with — the second has coordination problems the first does not, and that is
 * often the project. Neither figure is the whole answer to "how big", which is
 * why they sit in the same section.
 *
 * **Counts, not a list.** The register lets a charity declare up to 174 local
 * authorities, 4 UK regions and 275 foreign countries, and a client working
 * across sixty of them would push every other figure in this section off the
 * screen. The count is the scale signal; a couple of names make the count
 * concrete; the full list already exists as `OperatingAreasCard` on the
 * overview tab, so this links there rather than building a second copy of it
 * that would then have to be kept in step.
 *
 * **Only the Charity Commission publishes this.** Companies House registers an
 * entity by its registered office and collects no operational areas at all, so
 * a company-only record has nothing here. That is a gap in the registrar, not
 * in our ingestion, and the row says nothing rather than implying the charity
 * works from one address.
 */

/** Enough names to make a count concrete, few enough to stay one line. */
const NAMES_SHOWN = 3;

/** "Camden, Islington and Hackney" — the reader's own list grammar, not a
 *  comma-joined array. */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function countOf(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? singular : plural}`;
}

export function OperatingReachRow({
  geography,
  organisationId,
}: {
  geography: OperatingGeography;
  organisationId: string;
}) {
  const { localAuthorities, regions, countries, totalAreaCount } = geography;

  // A registered office is not a declared area of operation. Where the register
  // published no areas, the overview card already explains why in full and this
  // row has nothing to add.
  if (totalAreaCount === 0) return null;

  const parts = [
    localAuthorities.length > 0 &&
      countOf(localAuthorities.length, "local authority", "local authorities"),
    regions.length > 0 && countOf(regions.length, "UK region", "UK regions"),
    countries.length > 0 && countOf(countries.length, "country", "countries"),
  ].filter((part): part is string => Boolean(part));

  // Named examples come from the most specific list that has any, because
  // "Camden and Islington" tells a reader more than "England and Wales".
  const examples =
    localAuthorities.length > 0
      ? localAuthorities.slice(0, NAMES_SHOWN)
      : regions.length > 0
        ? regions.slice(0, NAMES_SHOWN)
        : // Already plain names off the register's label table ("Kenya"), not
          // ISO codes — `formatCountryName` is for the registered-office code
          // and would mangle these.
          countries.slice(0, NAMES_SHOWN);
  const named = examples.length;
  const beyond = totalAreaCount - named;

  return (
    <div className="border-t border-rule-soft pt-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          aria-hidden="true"
          className="shrink-0 self-center text-faint [&_svg]:size-3.5"
        >
          <MapPin />
        </span>
        <span className="text-[12.5px] text-dim">Operates across</span>
        <span className="text-[13px] font-semibold text-ink">
          {nameList(parts)}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] leading-[1.5] text-dim">
        {nameList(examples)}
        {beyond > 0 && (
          <>
            {" "}
            and {beyond.toLocaleString("en-GB")} more.{" "}
            <Link
              className="font-medium text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid"
              href={`/clients/${organisationId}#operating-geography-heading`}
            >
              See every area
            </Link>
          </>
        )}
        {beyond === 0 && "."}
      </p>
      <p className="mt-1 text-[11.5px] leading-[1.5] text-faint">
        Declared in the Charity Commission annual return as statutory areas of
        operation — where they say they work, not where they hold offices.
      </p>
    </div>
  );
}
