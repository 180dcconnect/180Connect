"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, ChevronDown, ExternalLink, Globe, MapPin, ShieldCheck } from "lucide-react";

import { SectionCard, Key, Pill } from "@/app/(app)/clients/[id]/section-card";
import { PageSizeSelect, PagingSummary, useListPager } from "@/components/ui/list-pager";
import { OrganisationHoverCard } from "@/components/organisation-hover-card";
import type { RawRecordView, StatusTone } from "./record-format";

/**
 * The records one import run touched, as a list to read rather than a wall to
 * scroll.
 *
 * The search box and the row of coloured status buttons that used to live here
 * are gone. Searching and filtering are done from the page's search bar — the
 * same bar as the client list and the import history — so what a CAM learned on
 * one screen works on this one, and the chosen filters survive a link, a
 * refresh and the back button. This component is handed the rows that survived
 * and renders them.
 *
 * Filed Record throughout (`docs/app-design-system.md`): one bordered card, a
 * pager above the first row because these lists only grow, rows separated by
 * the soft rule, state carried by `Pill` rather than a palette of its own, and
 * the detail panel folded with `card-collapse-grid` — nothing inside it opens a
 * popover, which is the one thing that class forbids.
 */

/** Four tones, from the token set. A record's state is never a colour of its own. */
const PILL_TONE: Record<StatusTone, "go" | "hold" | "stop" | "lead" | "neutral"> = {
  success: "go",
  warning: "hold",
  danger: "stop",
  info: "lead",
  neutral: "neutral",
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12.5px] text-dim">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] leading-[1.5] text-ink">{value}</dd>
    </div>
  );
}

export function RecordFeed({
  records,
  isGrantSource = false,
  filtersActive = false,
  orderNote,
  listedTotal,
  runTotal,
  windowSize,
}: {
  /** The records to show — already searched and filtered by the page. */
  records: RawRecordView[];
  isGrantSource?: boolean;
  /** Whether a search or filter is narrowing the list, for the empty state. */
  filtersActive?: boolean;
  /**
   * The order the rows are in, in words. A list that has been re-sorted from
   * somewhere else on the page — the sort button on the search bar — must say
   * so where the rows are, or the reader is left to infer the order from the
   * rows themselves.
   */
  orderNote?: string;
  /** How many records this page read for the run, before searching. */
  listedTotal: number;
  /** How many the run holds in total, which may be more than were read. */
  runTotal: number;
  /** The cap on how many are read in one visit. */
  windowSize: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pager = useListPager(records, 10);

  const thing = isGrantSource ? "grant" : "record";
  const things = isGrantSource ? "grants" : "records";
  const capped = runTotal > listedTotal;

  return (
    <SectionCard
      headingId="run-records-heading"
      title={isGrantSource ? "Grants in this run" : "Records in this run"}
      hint={
        <>
          {isGrantSource
            ? "Every grant this run read from 360Giving, and the client it was linked to."
            : "Every record this run read from the register, and what became of it. Open one to see what was filed."}
          {capped && (
            <>
              {" "}
              This run holds {runTotal.toLocaleString()} {things} in all; the{" "}
              {windowSize.toLocaleString()} most recent are listed.
            </>
          )}
        </>
      }
      action={
        pager.showPager ? (
          <PageSizeSelect pageSize={pager.pageSize} onChange={pager.setPageSize} />
        ) : undefined
      }
    >
      {records.length === 0 ? (
        /* Inset, not a second white card: a card inside a card needs a border
           to be seen, and a border inside a border is noise. */
        <p className="mt-3.5 rounded-inset bg-paper px-4 py-6 text-center text-[13px] leading-[1.55] text-dim">
          {filtersActive
            ? capped
              ? `No ${things} match this search among the ${windowSize.toLocaleString()} most recent — this run holds ${runTotal.toLocaleString()} in all, so a match further back would not be listed here. Clear the search to see the most recent ${windowSize.toLocaleString()}.`
              : `No ${things} match this search. Clear it from the search bar to see the whole run.`
            : `This run recorded no ${things}.`}
        </p>
      ) : (
        <>
          <div className="mt-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-1">
            <PagingSummary summary={pager} onPageChange={pager.setPage} className="min-w-0 flex-1" />
            {orderNote && <p className="text-[12.5px] text-faint">{orderNote}</p>}
          </div>

          <ul>
            {pager.items.map((record) => {
              const isOpen = expandedId === record.id;
              const panelId = `record-panel-${record.id}`;
              const place = record.city ?? record.postcode;

              return (
                <li key={record.id} className="border-t border-rule-soft">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setExpandedId(isOpen ? null : record.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedId(isOpen ? null : record.id);
                      }
                    }}
                    className="flex w-full cursor-pointer items-start gap-3 py-3.5 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <Pill tone={PILL_TONE[record.status.tone]}>{record.status.label}</Pill>
                        <span className="text-[15px] leading-[1.35] font-semibold text-ink">
                          {record.matchedOrg ? (
                            <OrganisationHoverCard
                              org={record.matchedOrg}
                              href={`/clients/${record.matchedOrgId}`}
                              className="text-lead hover:underline"
                            >
                              {record.name}
                            </OrganisationHoverCard>
                          ) : (
                            record.name
                          )}
                        </span>
                      </div>

                      <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-dim">
                        <span className="font-mono text-[12px] text-faint">
                          {record.sourceRecordId}
                        </span>
                        {place && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin aria-hidden="true" className="size-3 text-faint" />
                            {place}
                          </span>
                        )}
                        {record.filingType && <span>{record.filingType}</span>}
                        {record.redactedFieldCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <ShieldCheck aria-hidden="true" className="size-3 text-faint" />
                            Personal details removed
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {/* A record waiting on a decision offers the decision,
                          not the client. A possible duplicate was never added
                          to the client list — it is held in the duplicates
                          queue until an admin says whether it is the same
                          organisation — so "Open client" pointed at the client
                          it might duplicate and left the actual job unnamed.
                          Records held for review behave the same way, and both
                          already know where their queue is. */}
                      {record.status.reviewHref ? (
                        <Link
                          href={record.status.reviewHref}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={record.status.reviewLabel ?? "Resolve this record"}
                          title={record.status.reviewLabel ?? "Resolve this record"}
                          className="inline-flex items-center gap-1 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
                        >
                          Resolve
                          <ArrowRight aria-hidden="true" className="size-3" />
                        </Link>
                      ) : (
                        record.matchedOrgId && (
                          <Link
                            href={`/clients/${record.matchedOrgId}`}
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-inset px-2 py-0.5 text-[13px] font-medium text-lead transition-colors hover:bg-lead-wash"
                          >
                            Open client
                            <ExternalLink aria-hidden="true" className="size-3" />
                          </Link>
                        )
                      )}
                      <ChevronDown
                        aria-hidden="true"
                        className={`size-4 text-faint transition-transform duration-200 ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </div>

                  <div id={panelId} className="card-collapse-grid" data-expanded={isOpen}>
                    <div>
                      <div className="mb-3.5 rounded-inset bg-paper px-4 py-3.5">
                        <p className="text-[13px] leading-[1.55] text-ink">
                          {record.status.description}
                        </p>
                        {record.status.reviewHref && (
                          <Link
                            href={record.status.reviewHref}
                            className="mt-1.5 inline-block text-[13px] font-medium text-lead hover:underline"
                          >
                            {record.status.reviewLabel ?? "Open the queue"} →
                          </Link>
                        )}

                        <h3 className="mt-4 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                          <Building2 aria-hidden="true" className="size-[15px] text-faint" />
                          {record.grantDetails ? "What the funder published" : "What the register holds"}
                        </h3>

                        {record.grantDetails ? (
                          <dl className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <Fact
                              label="Funder"
                              value={record.grantDetails.funderName ?? "Not published"}
                            />
                            <Fact
                              label="Amount awarded"
                              value={record.grantDetails.amountFormatted ?? "Not published"}
                            />
                            <Fact
                              label="Award date"
                              value={record.grantDetails.awardDate ?? "Not published"}
                            />
                            <Fact
                              label="Programme"
                              value={record.grantDetails.grantProgramme ?? "Not published"}
                            />
                            <Fact
                              label="Recipient"
                              value={record.matchedOrg ? record.matchedOrg.legalName : record.name}
                            />
                            <Fact
                              label="Grant reference"
                              value={
                                <span className="font-mono text-[12.5px]">
                                  {record.sourceRecordId}
                                </span>
                              }
                            />
                          </dl>
                        ) : (
                          <dl className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <Fact label="Kind of organisation" value={record.filingType ?? "Not published"} />
                            <Fact
                              label="Status on the register"
                              value={record.registryStatus ?? "Not published"}
                            />
                            <Fact
                              label="Register number"
                              value={
                                <span className="font-mono text-[12.5px]">
                                  {record.sourceRecordId}
                                </span>
                              }
                            />
                            {record.fullAddress && (
                              <div className="sm:col-span-2">
                                <Fact label="Registered address" value={record.fullAddress} />
                              </div>
                            )}
                            {record.website && (
                              <Fact
                                label="Website"
                                value={
                                  <a
                                    href={
                                      record.website.startsWith("http")
                                        ? record.website
                                        : `https://${record.website}`
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex max-w-full items-center gap-1 text-lead hover:underline"
                                  >
                                    <Globe aria-hidden="true" className="size-3 shrink-0" />
                                    <span className="truncate">{record.website}</span>
                                  </a>
                                }
                              />
                            )}
                          </dl>
                        )}

                        {(record.grantDetails?.description ?? record.missionOrActivities) && (
                          <div className="mt-3.5 border-t border-rule-soft pt-3.5">
                            <p className="text-[12.5px] text-dim">
                              {record.grantDetails ? "What the grant is for" : "What they do"}
                            </p>
                            <p className="mt-0.5 text-[13.5px] leading-[1.55] text-ink">
                              {record.grantDetails?.description ?? record.missionOrActivities}
                            </p>
                          </div>
                        )}

                        <p className="mt-3.5 border-t border-rule-soft pt-3.5 text-[12.5px] text-dim">
                          Read from {record.recordSource.replace(/_/g, " ")} on{" "}
                          {record.receivedExact} ({record.receivedRelative}).
                        </p>
                      </div>

                      {record.redactedFieldCount > 0 && (
                        <p className="mb-3.5 rounded-inset bg-hold-wash px-4 py-3 text-[13px] leading-[1.55] text-ink">
                          <ShieldCheck
                            aria-hidden="true"
                            className="mr-1.5 inline size-[15px] align-[-2px] text-hold"
                          />
                          Personal contact details were removed before this{" "}
                          {thing} was saved, as the data handling rules require.
                        </p>
                      )}

                      <details className="mb-4 group">
                        <summary className="cursor-pointer list-none text-[12.5px] font-medium text-dim hover:text-ink">
                          <Key>For developers</Key>
                        </summary>
                        <pre className="mt-2 max-h-56 overflow-auto rounded-inset bg-paper p-3 font-mono text-[11px] leading-[1.5] text-dim">
                          {record.rawPayloadJson}
                        </pre>
                      </details>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SectionCard>
  );
}
