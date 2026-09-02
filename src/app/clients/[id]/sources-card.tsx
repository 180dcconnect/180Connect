import Image from "next/image";
import { BookOpen } from "lucide-react";

import type { OrganisationSource } from "@/lib/source-tracking";
import { SectionCard } from "./section-card";

/**
 * Which registers this record was assembled from.
 *
 * **The three rows are design scaffolding, not data.** They render on every
 * client so the layout can be worked on against a full card while the ingestion
 * side catches up — real sources are merged in on top of them, and once every
 * record carries its own, `placeholder` goes to `false` (or the constant goes)
 * and nothing else here changes.
 *
 * Until then, do not treat what this card shows as citable: the reference codes
 * on a placeholder row are derived from the organisation's UUID, and the date is
 * the record's creation date, not the day the register was read. Real rows —
 * anything that came out of ORGANISATION_SOURCES — carry the register's own
 * record id and its true `first_seen_at`, and are marked as such in the source
 * list below so the two are never confused in code.
 */

/**
 * Wordmarks for the registers we hold one for. Keys are ORGANISATION_SOURCES
 * `source` values (see SOURCE_LABELS in source-tracking.ts). Anything without a
 * file falls back to a monogram — deliberately, rather than a generic globe
 * icon: a real logo beside a placeholder icon reads as "we could not find this
 * one", when the truth is only that we do not ship its image.
 */
const SOURCE_LOGOS: Readonly<Record<string, string>> = {
  charity_commission: "/sources/charity-commission.png",
  companies_house: "/sources/companies-house.png",
  "360giving": "/sources/360giving.png",
};

/**
 * Design scaffolding — see the header. These three render on every client so the
 * card is never a one-row stub while the layout is being worked on. Their codes
 * are derived from the organisation's UUID and mean nothing; a real row always
 * wins over the placeholder for the same register.
 *
 * Delete this constant (and the `placeholder` prop) once ORGANISATION_SOURCES is
 * populated everywhere.
 */
const PLACEHOLDER_SOURCES: { source: string; label: string; prefix: string }[] =
  [
    {
      source: "charity_commission",
      label: "Charity Commission",
      prefix: "CC-",
    },
    { source: "companies_house", label: "Companies House", prefix: "CH-0" },
    { source: "360giving", label: "360Giving", prefix: "360G-UK-" },
  ];

type SourceRow = {
  source: string;
  label: string;
  recordId: string | null;
  seenAt: string | null;
  actor: string | null;
  real: boolean;
};

function buildRows(
  sources: OrganisationSource[],
  placeholder: boolean,
  organisationId: string,
  createdAt: string | null,
): SourceRow[] {
  const rows: SourceRow[] = sources.map((source) => ({
    source: source.source,
    label: source.label,
    recordId: source.source_record_id?.trim() || null,
    seenAt: source.first_seen_at,
    actor: source.source_actor_name?.trim() || null,
    real: true,
  }));

  if (!placeholder) return rows;

  const present = new Set(rows.map((row) => row.source));
  const hash = organisationId.replace(/-/g, "").slice(0, 7).toUpperCase();

  for (const stub of PLACEHOLDER_SOURCES) {
    if (present.has(stub.source)) continue;
    rows.push({
      source: stub.source,
      label: stub.label,
      recordId: `${stub.prefix}${hash.slice(0, stub.prefix === "CC-" ? 7 : 6)}`,
      seenAt: createdAt,
      actor: null,
      real: false,
    });
  }

  return rows;
}

function monogram(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function formatDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function SourcesCard({
  sources,
  organisationId,
  createdAt = null,
  error = false,
  placeholder = true,
}: {
  sources: OrganisationSource[];
  organisationId: string;
  createdAt?: string | null;
  /** The sources query failed — say so rather than showing an empty card. */
  error?: boolean;
  /** Design scaffolding: fill the card out to three registers. */
  placeholder?: boolean;
}) {
  const rows = buildRows(sources, placeholder, organisationId, createdAt);

  return (
    <SectionCard
      headingId="source-heading"
      title="Where this came from"
      hint="Every register and dataset that contributed to this record."
      icon={<BookOpen />}
    >
      {error ? (
        <p className="mt-3.5 text-sm font-semibold text-stop" role="alert">
          The source list could not be loaded. Refresh and try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3.5 text-sm leading-[1.6] text-dim">
          No source is recorded against this client yet. That is a gap in the
          record&rsquo;s own history, not a claim that it came from nowhere.
        </p>
      ) : (
        <ul className="mt-3.5">
          {rows.map((source) => {
            const logo = SOURCE_LOGOS[source.source];
            const seen = source.seenAt ? formatDate(source.seenAt) : null;
            // A manual entry's "register" is a person, so the row names them
            // instead of pretending to a registry.
            const actor = source.actor;

            return (
              <li
                key={source.source}
                className="flex items-center gap-3.5 py-3 first:border-t-0 first:pt-0"
              >
                {/* No tile, no border, no plate. A wordmark is already a
                    designed object with its own margins; framing one is putting
                    a frame around a frame, and it forced the logo down to 32px
                    of usable space inside a 44px box. Unframed it can be the
                    size it deserves. */}
                {logo ? (
                  <span className="flex size-14 shrink-0 items-center justify-center">
                    <Image
                      src={logo}
                      alt=""
                      width={56}
                      height={56}
                      className="max-h-full max-w-full object-contain"
                    />
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex size-14 shrink-0 items-center justify-center font-mono text-[15px] font-semibold tracking-[0.02em] text-faint"
                  >
                    {monogram(source.label)}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17.5px] font-semibold text-ink">
                    {source.label}
                  </p>
                  {/* One line, and only the parts that exist. A register with no
                      record id captured says nothing where the id would be
                      rather than filling the space with a placeholder. */}
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[12px] text-dim">
                    {source.recordId && (
                      <span className="font-mono text-ink/70">
                        {source.recordId}
                      </span>
                    )}
                    {actor && <span>Added by {actor}</span>}
                    {seen && (
                      <span className="text-faint">
                        {source.source === "manual" ? "on" : "Added on"}{" "}
                        {seen}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
