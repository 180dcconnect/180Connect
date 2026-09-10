"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Globe,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { EASE } from "@/components/brand/motion";
import { OrganisationHoverCard } from "@/components/organisation-hover-card";
import {
  matchesRecordQuery,
  type ProcessingStatus,
  type RawRecordView,
} from "./record-format";

export function RecordFeed({
  records,
  source,
  recordsSkipped,
  isGrantSource = false,
}: {
  records: RawRecordView[];
  source: string;
  recordsSkipped: number;
  isGrantSource?: boolean;
}) {
  const [activeFilter, setActiveFilter] = useState<"all" | ProcessingStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Counts for each tab
  const counts = useMemo(() => {
    return {
      all: records.length,
      validated: records.filter((r) => r.processingStatus === "validated").length,
      matched: records.filter((r) => r.processingStatus === "matched").length,
      pending: records.filter((r) => r.processingStatus === "pending").length,
      rejected: records.filter((r) => r.processingStatus === "rejected").length,
      error: records.filter((r) => r.processingStatus === "error").length,
    };
  }, [records]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (activeFilter !== "all" && record.processingStatus !== activeFilter) {
        return false;
      }
      return matchesRecordQuery(record, searchQuery);
    });
  }, [records, activeFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Informational banner about Skipped records */}
      {recordsSkipped > 0 && (
        <div className="flex items-start gap-3.5 rounded-2xl border border-black/[0.07] bg-white p-4.5 shadow-2xs">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-green-50 text-green-700">
            <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground/50">
              Already Up to Date in 180Connect
            </h3>
            <p className="mt-0.5 text-xs leading-[1.6] text-foreground/80">
              <strong className="text-foreground font-bold">{recordsSkipped.toLocaleString()} {isGrantSource ? (recordsSkipped === 1 ? "grant" : "grants") : (recordsSkipped === 1 ? "organisation" : "organisations")}</strong> from {source} were verified and found to be already up to date with no new changes on record.
            </p>
          </div>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setActiveFilter("all")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                activeFilter === "all"
                  ? "bg-foreground text-background shadow-2xs"
                  : "bg-white text-foreground/70 ring-1 ring-black/[0.08] hover:bg-black/[0.02]"
              }`}
            >
              {isGrantSource ? "All Grants" : "All Organisations"}
              <span className="opacity-60 tabular-nums">({counts.all})</span>
            </button>

            {counts.validated > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter("validated")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  activeFilter === "validated"
                    ? "bg-green-800 text-white shadow-2xs"
                    : "bg-white text-green-900 ring-1 ring-green-600/20 hover:bg-green-50/50"
                }`}
              >
                {isGrantSource ? "Saved Grants" : "Added to CRM"}
                <span className="opacity-75 tabular-nums">({counts.validated})</span>
              </button>
            )}

            {counts.matched > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter("matched")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  activeFilter === "matched"
                    ? isGrantSource
                      ? "bg-green-800 text-white shadow-2xs"
                      : "bg-amber-800 text-white shadow-2xs"
                    : isGrantSource
                      ? "bg-white text-green-900 ring-1 ring-green-600/20 hover:bg-green-50/50"
                      : "bg-white text-amber-900 ring-1 ring-amber-600/20 hover:bg-amber-50/50"
                }`}
              >
                {isGrantSource ? "Matched to Clients" : "Needs Review"}
                <span className="opacity-75 tabular-nums">({counts.matched})</span>
              </button>
            )}

            {counts.pending > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter("pending")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  activeFilter === "pending"
                    ? "bg-blue-800 text-white shadow-2xs"
                    : "bg-white text-blue-900 ring-1 ring-blue-600/20 hover:bg-blue-50/50"
                }`}
              >
                Pending
                <span className="opacity-75 tabular-nums">({counts.pending})</span>
              </button>
            )}

            {counts.rejected > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter("rejected")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  activeFilter === "rejected"
                    ? "bg-foreground/80 text-background shadow-2xs"
                    : "bg-white text-foreground/70 ring-1 ring-black/[0.08] hover:bg-black/[0.02]"
                }`}
              >
                {isGrantSource ? "Unmatched" : "Excluded"}
                <span className="opacity-75 tabular-nums">({counts.rejected})</span>
              </button>
            )}

            {counts.error > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter("error")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  activeFilter === "error"
                    ? "bg-red-800 text-white shadow-2xs"
                    : "bg-white text-red-900 ring-1 ring-red-600/20 hover:bg-red-50/50"
                }`}
              >
                Issues
                <span className="opacity-75 tabular-nums">({counts.error})</span>
              </button>
            )}
          </div>

          {/* Quick Search */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search organisation or ID…"
              className="w-full rounded-full border border-black/[0.08] bg-white py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-foreground/40 focus:border-brand focus:outline-hidden focus:ring-1 focus:ring-brand"
            />
          </div>
        </div>
      </div>

      {/* Records Feed List */}
      {filteredRecords.length > 0 ? (
        <ul className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
          {filteredRecords.map((record) => {
            const isOpen = expandedId === record.id;
            return (
              <li
                key={record.id}
                className="border-b border-black/[0.06] last:border-b-0 transition-colors"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedId(isOpen ? null : record.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedId(isOpen ? null : record.id);
                    }
                  }}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-3.5 p-4 text-left hover:bg-black/[0.015] cursor-pointer sm:items-center sm:gap-4 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${record.status.badgeClass}`}
                      >
                        {record.status.label}
                      </span>
                      <span className="text-[11px] font-bold text-foreground/50">
                        {record.recordSource.replace(/_/g, " ")} #{record.sourceRecordId}
                      </span>
                      {record.city && (
                        <span className="inline-flex items-center gap-1 text-xs text-foreground/60">
                          <MapPin className="h-3 w-3 opacity-60" />
                          {record.city}
                        </span>
                      )}
                      {record.filingType && (
                        <span className="inline-flex items-center gap-1 text-xs text-foreground/50 hidden md:inline">
                          · {record.filingType}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex items-baseline gap-3">
                      <h4 className="text-base font-bold text-foreground">
                        {record.matchedOrg ? (
                          <OrganisationHoverCard
                            org={record.matchedOrg}
                            href={`/clients/${record.matchedOrgId}`}
                            className="underline decoration-black/20 hover:decoration-brand hover:text-brand transition-colors"
                          >
                            {record.name}
                          </OrganisationHoverCard>
                        ) : (
                          <span>{record.name}</span>
                        )}
                      </h4>
                    </div>
                  </div>

                  {/* Actions & Chevron */}
                  <div className="flex shrink-0 items-center gap-3">
                    {record.matchedOrgId && (
                      <Link
                        href={`/clients/${record.matchedOrgId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-lead px-3 py-1.5 text-xs font-bold text-white hover:bg-lead-hover transition-colors shadow-2xs"
                      >
                        <span>View Client</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}

                    <motion.span
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ duration: 0.25, ease: EASE }}
                      className="text-foreground/30"
                    >
                      <ChevronDown className="h-4 w-4" strokeWidth={2} />
                    </motion.span>
                  </div>
                </div>

                {/* Expanded Clean Business Profile */}
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="details"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className="overflow-hidden border-t border-black/[0.05] bg-black/[0.015] px-4 py-5 sm:px-5"
                    >
                      <div className="space-y-4">
                        {record.grantDetails ? (
                          <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-2xs">
                            <h5 className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/45 mb-3 flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5" />
                              <span>Grant Details &amp; Funding Overview</span>
                            </h5>

                            <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <dt className="font-bold text-foreground/45">Funder</dt>
                                <dd className="mt-0.5 font-medium text-foreground">
                                  {record.grantDetails.funderName ?? "Unknown Funder"}
                                </dd>
                              </div>

                              <div>
                                <dt className="font-bold text-foreground/45">Amount Awarded</dt>
                                <dd className="mt-0.5 font-medium text-foreground">
                                  {record.grantDetails.amountFormatted ?? "Undisclosed"}
                                </dd>
                              </div>

                              <div>
                                <dt className="font-bold text-foreground/45">Award Date</dt>
                                <dd className="mt-0.5 font-medium text-foreground">
                                  {record.grantDetails.awardDate ?? "Undisclosed"}
                                </dd>
                              </div>

                              <div>
                                <dt className="font-bold text-foreground/45">Grant Programme</dt>
                                <dd className="mt-0.5 font-medium text-foreground">
                                  {record.grantDetails.grantProgramme ?? "General Grant"}
                                </dd>
                              </div>

                              <div>
                                <dt className="font-bold text-foreground/45">Recipient Client</dt>
                                <dd className="mt-0.5 font-medium text-foreground">
                                  {record.matchedOrg ? record.matchedOrg.legalName : record.name}
                                </dd>
                              </div>

                              <div>
                                <dt className="font-bold text-foreground/45">Official Grant ID</dt>
                                <dd className="mt-0.5 font-mono font-medium text-foreground">
                                  #{record.sourceRecordId}
                                </dd>
                              </div>
                            </dl>

                            {record.grantDetails.description && (
                              <div className="mt-3.5 pt-3.5 border-t border-black/[0.05]">
                                <p className="font-bold text-foreground/45 text-xs">Grant Description</p>
                                <p className="mt-1 text-xs leading-[1.6] text-foreground/80">
                                  {record.grantDetails.description}
                                </p>
                              </div>
                            )}
                          </div>
                        ) : (
                          /* Business Summary Card */
                          <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-2xs">
                            <h5 className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/45 mb-3 flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5" />
                              <span>Official Filing Overview</span>
                            </h5>

                            <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <dt className="font-bold text-foreground/45">Organisation Type</dt>
                                <dd className="mt-0.5 font-medium text-foreground">
                                  {record.filingType ?? "Standard Organisation"}
                                </dd>
                              </div>

                              <div>
                                <dt className="font-bold text-foreground/45">Register Status</dt>
                                <dd className="mt-0.5 font-medium text-foreground">
                                  {record.registryStatus ?? "Active on Register"}
                                </dd>
                              </div>

                              <div>
                                <dt className="font-bold text-foreground/45">Official Number</dt>
                                <dd className="mt-0.5 font-mono font-medium text-foreground">
                                  #{record.sourceRecordId}
                                </dd>
                              </div>

                              {record.fullAddress && (
                                <div className="sm:col-span-2">
                                  <dt className="font-bold text-foreground/45">Registered Office</dt>
                                  <dd className="mt-0.5 text-foreground/85">
                                    {record.fullAddress}
                                  </dd>
                                </div>
                              )}

                              {record.website && (
                                <div>
                                  <dt className="font-bold text-foreground/45">Website</dt>
                                  <dd className="mt-0.5">
                                    <a
                                      href={record.website.startsWith("http") ? record.website : `https://${record.website}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-brand hover:underline"
                                    >
                                      <Globe className="h-3 w-3" />
                                      <span className="truncate max-w-[200px]">{record.website}</span>
                                    </a>
                                  </dd>
                                </div>
                              )}
                            </dl>

                            {record.missionOrActivities && (
                              <div className="mt-3.5 pt-3.5 border-t border-black/[0.05]">
                                <p className="font-bold text-foreground/45 text-xs">Activities &amp; Purpose</p>
                                <p className="mt-1 text-xs leading-[1.6] text-foreground/80">
                                  {record.missionOrActivities}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Privacy Redaction Notice (if applicable) */}
                        {record.redactedFieldCount > 0 && (
                          <div className="flex items-center gap-2 rounded-xl bg-amber-50/70 border border-amber-200/80 px-3.5 py-2.5 text-xs text-amber-950">
                            <ShieldCheck className="h-4 w-4 shrink-0 text-amber-700" />
                            <span>
                              Personal contact details (private phone/email) were automatically removed before storing to comply with privacy rules.
                            </span>
                          </div>
                        )}

                        {/* Collapsed Technical Details (for developers only) */}
                        <details className="text-[11px] text-foreground/40">
                          <summary className="cursor-pointer font-mono hover:underline">
                            Developer Diagnostics / Raw Data
                          </summary>
                          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/[0.03] p-3 font-mono text-[10px] text-foreground/70 ring-1 ring-black/[0.05]">
                            {record.rawPayloadJson}
                          </pre>
                        </details>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-2xl border border-black/[0.06] bg-white p-12 text-center shadow-xs">
          <p className="text-sm font-bold text-foreground">
            {isGrantSource ? "No grants match this search." : "No organisations match this search."}
          </p>
          <p className="mt-1 text-xs text-foreground/60">
            {isGrantSource
              ? "Try searching by funder name, recipient, grant ID, or selecting a different status filter tab."
              : "Try searching by organisation name, charity number, or selecting a different status filter tab."}
          </p>
        </div>
      )}
    </div>
  );
}
