"use client";

import Image from "next/image";
import { BookOpen } from "lucide-react";

import type { OrganisationSource } from "@/lib/source-tracking";
import { SOURCE_LABELS } from "@/lib/source-tracking";
import { formatShortDate } from "@/lib/display-format";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { SectionCard } from "./section-card";

/**
 * Which registers this record was assembled from.
 *
 * Every row here is real: the card renders exactly what
 * `get_organisation_sources_with_actor` returns — sources linked through
 * RAW_SOURCE_RECORDS, plus Manual Entry where `entry_method = 'manual'`. An
 * earlier version filled the card out to three registers with placeholder rows
 * while ingestion caught up; now that real provenance exists end to end, the
 * placeholders are gone, so an empty card means a genuine provenance gap —
 * which is the signal the ingestion-gap audit (20260913170000) watches for.
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
  charity_commission_bulk: "/sources/charity-commission.png",
  companies_house: "/sources/companies-house.png",
  "360giving": "/sources/360giving.png",
};

/**
 * Explanations of what each data source is and its relevance to 180Connect.
 */
const SOURCE_DETAILS: Readonly<
  Record<string, { summary: string; relevance: string }>
> = {
  charity_commission: {
    summary:
      "The official statutory regulator of charities in England and Wales.",
    relevance:
      "Verifies legal charitable status, public benefit objectives, trustee governance, and annual filing compliance.",
  },
  charity_commission_bulk: {
    summary:
      "The official statutory regulator of charities in England and Wales.",
    relevance:
      "Verifies legal charitable status, public benefit objectives, trustee governance, and annual filing compliance.",
  },
  companies_house: {
    summary:
      "The UK executive agency that incorporates and registers all corporate entities.",
    relevance:
      "Confirms company incorporation, CIC status, registered directors, and statutory balance sheet filings.",
  },
  "360giving": {
    summary:
      "The UK open data initiative and global publishing standard for grantmaking.",
    relevance:
      "Maps institutional grant distributions, philanthropic funder networks, and awarded funding history.",
  },
  charitybase: {
    summary:
      "Open-source UK charity database and API platform aggregating registry data.",
    relevance:
      "Provides structured metadata on charitable activities, operational areas, and digital contact information.",
  },
  find_that_charity: {
    summary:
      "Unified open index linking non-profits across diverse UK regulators.",
    relevance:
      "Reconciles dual-registered charities, CICs, and mutuals across regional registries into one record.",
  },
  globalgiving: {
    summary:
      "International crowdfunding community and non-profit directory connecting vetted NGOs worldwide.",
    relevance:
      "Supplies international validation, vetted development projects, and global donor impact tracking.",
  },
  candid: {
    summary:
      "Premier global non-profit dataset formed by Foundation Center and GuideStar.",
    relevance:
      "Delivers international financial benchmarking, philanthropic research, and 990 non-profit filings.",
  },
  manual: {
    summary:
      "Primary information curated or imported directly by a 180 Degrees team member.",
    relevance:
      "Captures verified primary intelligence, direct client stakeholder contacts, and fresh organizational updates.",
  },
};

type SourceRow = {
  source: string;
  label: string;
  recordId: string | null;
  seenAt: string | null;
  actor: string | null;
};

function buildRows(sources: OrganisationSource[]): SourceRow[] {
  return sources.map((source) => ({
    source: source.source,
    label: source.label,
    recordId: source.source_record_id?.trim() || null,
    seenAt: source.first_seen_at,
    actor: source.source_actor_name?.trim() || null,
  }));
}

function monogram(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}



/**
 * Manual Input, rendered like any other register row — same geometry, same
 * monogram treatment (there is no wordmark for a person), same detail
 * tooltip. Unlike a register it has no single "added on": its contributions
 * are per-field, so the sub-line names the two places its rows are visible
 * instead of pretending to a date. Rendered only when FIELD_SOURCES actually
 * carries a hand-entered value (hasManualFields) — never as a filler row.
 */
function ManualEntryRow() {
  const details = SOURCE_DETAILS.manual;
  const label = SOURCE_LABELS.manual;

  return (
    <li className="flex items-center gap-3.5 py-3 first:border-t-0 first:pt-0">
      <InfoTooltip
        title={details ? label : undefined}
        content={details?.summary}
        footer={
          details ? (
            <>
              <strong className="font-semibold text-white/90">Relevance:</strong>{" "}
              {details.relevance}
            </>
          ) : undefined
        }
      >
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 cursor-help items-center justify-center font-mono text-[15px] font-semibold tracking-[0.02em] text-faint"
        >
          {monogram(label)}
        </span>
      </InfoTooltip>

      <div className="min-w-0 flex-1">
        <p className="text-[17.5px] font-semibold text-ink">{label}</p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[12px] text-dim">
          <span>Hand-entered field values</span>
          <span className="text-faint">
            per field on the Activity tab&rsquo;s what-came-from-where card
          </span>
        </p>
      </div>
    </li>
  );
}

export function SourcesCard({
  sources,
  error = false,
  hasManualFields = false,
}: {
  sources: OrganisationSource[];
  /** The sources query failed — say so rather than showing an empty card. */
  error?: boolean;
  /**
   * FIELD_SOURCES carries at least one hand-entered value on this record
   * (a manual entry approval, an admin edit, an approved suggestion). The
   * Manual Input row is only honest when that is true: registers contribute
   * through RAW_SOURCE_RECORDS, a person contributes through field
   * provenance, and inventing the person's row for a record built entirely
   * from registers would be exactly the placeholder this card once removed.
   */
  hasManualFields?: boolean;
}) {
  const rows = buildRows(sources);

  return (
    <SectionCard
      headingId="source-heading"
      title="Data Sources"
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
          {hasManualFields && <ManualEntryRow />}
          {rows.map((source) => {
            const logo = SOURCE_LOGOS[source.source];
            const seen = source.seenAt ? formatShortDate(source.seenAt) : null;
            // A manual entry's "register" is a person, so the row names them
            // instead of pretending to a registry.
            const actor = source.actor;
            const details = SOURCE_DETAILS[source.source];

            return (
              <li
                key={source.source}
                className="flex items-center gap-3.5 py-3 first:border-t-0 first:pt-0"
              >
                <InfoTooltip
                  title={details ? source.label : undefined}
                  content={details?.summary}
                  footer={
                    details ? (
                      <>
                        <strong className="font-semibold text-white/90">
                          Relevance:
                        </strong>{" "}
                        {details.relevance}
                      </>
                    ) : undefined
                  }
                >
                  {/* No tile, no border, no plate. A wordmark is already a
                      designed object with its own margins; framing one is putting
                      a frame around a frame, and it forced the logo down to 32px
                      of usable space inside a 44px box. Unframed it can be the
                      size it deserves. */}
                  {logo ? (
                    <span className="flex size-14 shrink-0 cursor-help items-center justify-center">
                      <Image
                        src={logo}
                        alt=""
                        width={56}
                        height={56}
                        className={`max-h-full object-contain ${
                          source.source === "360giving"
                            ? "max-w-none w-auto h-12 scale-85"
                            : source.source === "companies_house"
                              ? "max-w-none w-auto h-14 scale-125"
                              : source.source === "charity_commission" ||
                                source.source === "charity_commission_bulk"
                                ? "max-w-none w-auto h-14 scale-110"
                                : "max-w-full"
                        }`}
                      />
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-14 shrink-0 cursor-help items-center justify-center font-mono text-[15px] font-semibold tracking-[0.02em] text-faint"
                    >
                      {monogram(source.label)}
                    </span>
                  )}
                </InfoTooltip>

                <div className="min-w-0 flex-1">
                  <InfoTooltip
                    title={details ? source.label : undefined}
                    content={details?.summary}
                    footer={
                      details ? (
                        <>
                          <strong className="font-semibold text-white/90">
                            Relevance:
                          </strong>{" "}
                          {details.relevance}
                        </>
                      ) : undefined
                    }
                  >
                    <p className="w-fit cursor-help truncate text-[17.5px] font-semibold text-ink hover:text-lead">
                      {source.label}
                    </p>
                  </InfoTooltip>
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
