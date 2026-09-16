"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Building2, ChevronRight, ExternalLink, Search } from "lucide-react";

import { formatLocation, formatOutreachStatus } from "@/lib/organisation-format";
import { Pill, SectionCard } from "@/app/clients/[id]/section-card";

export type AssignedClientItem = {
  id: string;
  legal_name: string;
  organisation_type: string;
  city: string | null;
  country_code: string | null;
  outreach_status: string;
  priority_score: number | null;
  created_at: string;
  updated_at: string;
  is_suppressed: boolean;
};

type FilterCategory = "all" | "outreach" | "discussion" | "won" | "discovery" | "closed";

const CATEGORY_MATCHERS: Record<FilterCategory, (status: string) => boolean> = {
  all: () => true,
  outreach: (s) => ["initial_outreach_sent", "follow_up_1_sent", "follow_up_2_sent"].includes(s),
  discussion: (s) => ["meeting_held", "proposal_requested", "proposal_submitted"].includes(s),
  won: (s) => s === "converted",
  discovery: (s) => s === "not_contacted",
  closed: (s) => ["stalled", "rejected", "unresponsive", "do_not_contact"].includes(s),
};

function toneForStatus(status: string): "go" | "stop" | "neutral" | "hold" {
  if (status === "converted") return "go";
  if (["meeting_held", "proposal_requested", "proposal_submitted"].includes(status)) return "go";
  if (["initial_outreach_sent", "follow_up_1_sent", "follow_up_2_sent"].includes(status)) return "hold";
  if (["stalled", "rejected", "unresponsive", "do_not_contact"].includes(status)) return "stop";
  return "neutral";
}

export function AssignedClientsCard({
  clients,
  userId,
  displayName,
}: {
  clients: AssignedClientItem[];
  userId: string;
  displayName: string;
}) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FilterCategory>("all");

  const counts = useMemo(() => {
    return {
      all: clients.length,
      outreach: clients.filter((c) => CATEGORY_MATCHERS.outreach(c.outreach_status)).length,
      discussion: clients.filter((c) => CATEGORY_MATCHERS.discussion(c.outreach_status)).length,
      won: clients.filter((c) => CATEGORY_MATCHERS.won(c.outreach_status)).length,
      discovery: clients.filter((c) => CATEGORY_MATCHERS.discovery(c.outreach_status)).length,
      closed: clients.filter((c) => CATEGORY_MATCHERS.closed(c.outreach_status)).length,
    };
  }, [clients]);

  const filtered = useMemo(() => {
    const matcher = CATEGORY_MATCHERS[activeCategory];
    const q = query.trim().toLowerCase();
    return clients.filter((client) => {
      if (!matcher(client.outreach_status)) return false;
      if (!q) return true;
      const name = client.legal_name.toLowerCase();
      const type = client.organisation_type.toLowerCase();
      const city = (client.city ?? "").toLowerCase();
      return name.includes(q) || type.includes(q) || city.includes(q);
    });
  }, [clients, activeCategory, query]);

  const tabs: { key: FilterCategory; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "outreach", label: "In Outreach", count: counts.outreach },
    { key: "discussion", label: "Discussion", count: counts.discussion },
    { key: "won", label: "Won", count: counts.won },
    { key: "discovery", label: "Discovery", count: counts.discovery },
    { key: "closed", label: "Closed / Stalled", count: counts.closed },
  ];

  return (
    <SectionCard
      headingId="assigned-clients-heading"
      title="Assigned Clients"
      hint={`Organisations actively assigned to ${displayName}.`}
      icon={<Building2 />}
      action={
        clients.length > 0 ? (
          <Link
            href={`/clients?owner=${userId}`}
            className="inline-flex h-8.5 items-center gap-1.5 rounded-full border border-rule bg-white px-3.5 text-xs font-semibold text-ink transition-colors hover:border-faint hover:bg-paper focus-visible:outline-2 focus-visible:outline-lead-mid"
          >
            <span>View in Clients Table</span>
            <ExternalLink aria-hidden="true" className="size-3 text-faint" />
          </Link>
        ) : null
      }
    >
      {clients.length === 0 ? (
        <div className="py-10 text-center">
          <Building2 aria-hidden="true" className="mx-auto size-8 text-faint" />
          <p className="mt-2 text-sm font-semibold text-ink">No clients assigned</p>
          <p className="mt-0.5 text-xs text-dim">
            This team member does not currently own any client accounts.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3.5">
          {/* Controls: Search + Category Filter Tabs */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1">
              {tabs
                .filter((tab) => tab.key === "all" || tab.count > 0)
                .map((tab) => {
                  const isActive = activeCategory === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveCategory(tab.key)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                        isActive
                          ? "bg-ink text-white shadow-xs"
                          : "bg-paper text-dim hover:bg-paper-sunk hover:text-ink"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`rounded-full px-1 text-[10px] font-mono tabular-nums ${
                          isActive ? "bg-white/20 text-white" : "bg-black/[0.06] text-faint"
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
            </div>

            {/* Search Input */}
            <div className="relative min-w-[180px] max-w-xs">
              <Search
                aria-hidden="true"
                className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter clients…"
                className="h-7.5 w-full rounded-full border border-rule bg-white pl-8 pr-3 text-xs text-ink placeholder:text-faint focus:border-lead-mid focus:outline-none focus:ring-1 focus:ring-lead-mid"
              />
            </div>
          </div>

          {/* Client List */}
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-dim">
              No clients match your filter criteria.
            </p>
          ) : (
            <ul className="divide-y divide-rule/50 rounded-panel border border-rule bg-white overflow-hidden">
              {filtered.map((client) => {
                const location = formatLocation({
                  city: client.city,
                  country_code: client.country_code ?? "GB",
                });
                const tone = toneForStatus(client.outreach_status);

                return (
                  <li key={client.id}>
                    <Link
                      href={`/clients/${client.id}`}
                      className="group flex flex-col gap-2 p-3.5 px-4 transition-colors hover:bg-paper/70 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[13.5px] font-semibold text-ink group-hover:text-lead transition-colors">
                            {client.legal_name}
                          </span>
                          {client.is_suppressed && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-stop-wash px-2 py-0.5 text-[10px] font-semibold text-stop">
                              <AlertCircle className="size-2.5" />
                              Suppressed
                            </span>
                          )}
                          {client.priority_score !== null && (
                            <span className="font-mono text-[11px] font-medium text-dim bg-paper px-1.5 py-0.2 rounded border border-rule-soft tabular-nums">
                              Score {client.priority_score.toFixed(1)}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11.5px] text-dim">
                          {client.organisation_type}
                          {location ? ` · ${location}` : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <Pill tone={tone}>
                          {formatOutreachStatus(client.outreach_status)}
                        </Pill>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}
