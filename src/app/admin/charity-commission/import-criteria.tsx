import { Banknote, MapPin, Tags } from "lucide-react";

import {
  CLASSIFICATION_TO_SECTOR,
  MIN_INCOME,
  PRIORITY_LOCAL_AUTHORITIES,
  PRIORITY_POSTCODE_PREFIXES,
} from "@/lib/ingestion/sources/charity-commission-bulk-config";

/**
 * What the bulk import accepts, rendered from the config it actually applies.
 *
 * Read straight from charity-commission-bulk-config.ts rather than restated
 * here: a criteria panel that can disagree with the filter is worse than no
 * panel, because it is believed. Anyone changing the thresholds changes this
 * page in the same edit without knowing the page exists.
 *
 * This is the answer to the question the old page could not answer at all —
 * "why isn't charity X in the client list" — which previously required reading
 * TypeScript to settle.
 */

function Row({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3.5 py-4 first:pt-0 last:pb-0">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-black/[0.04] text-foreground/55">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <div className="mt-1.5 text-sm leading-[1.6] text-foreground/65">{children}</div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-semibold text-foreground/75">
      {children}
    </span>
  );
}

export function ImportCriteria() {
  const sectors = Object.entries(CLASSIFICATION_TO_SECTOR);

  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
      <h2 className="text-sm font-bold text-foreground">What gets imported</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-[1.6] text-foreground/60">
        The register holds every charity in England and Wales. A charity enters
        the client list only by matching all three of these — so if one is
        missing, this is where to look first.
      </p>

      <div className="mt-4 divide-y divide-black/[0.06]">
        <Row icon={<Banknote className="h-4 w-4" strokeWidth={2.2} />} title="Income">
          At least{" "}
          <span className="font-bold text-foreground/85 tabular-nums">
            £{MIN_INCOME.toLocaleString("en-GB")}
          </span>{" "}
          a year. Below that a charity has no capacity to host a consulting
          project, and it is the same boundary the income bands already draw.
        </Row>

        <Row icon={<Tags className="h-4 w-4" strokeWidth={2.2} />} title="Sector">
          <p>
            One of the regulator&rsquo;s own &ldquo;what the charity does&rdquo;
            classifications, mapped to the sector the scoring model uses:
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {sectors.map(([classification, sector]) => (
              <li key={classification} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-foreground/80">{classification}</span>
                <span aria-hidden className="text-foreground/25">
                  &rarr;
                </span>
                <Chip>{sector}</Chip>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-xs leading-[1.6] text-foreground/50">
            Arts, heritage, environment and religion are left out of the import
            rather than merely scored low — a client the model will always rank
            last is a row to scroll past.
          </p>
        </Row>

        <Row icon={<MapPin className="h-4 w-4" strokeWidth={2.2} />} title="Location">
          <p>
            Either the register says the charity <em>operates</em> in one of the
            branch&rsquo;s local authorities, or its correspondence address sits
            in one of its postcode areas. Either is enough on its own.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {PRIORITY_LOCAL_AUTHORITIES.map((authority) => (
              <Chip key={authority}>
                <span className="capitalize">{authority}</span>
              </Chip>
            ))}
            {PRIORITY_POSTCODE_PREFIXES.map((prefix) => (
              <Chip key={prefix}>{prefix} postcodes</Chip>
            ))}
          </div>
        </Row>
      </div>
    </section>
  );
}
