"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface AdminQueueCounts {
  pendingSuppressions: number;
  ownershipRequests: number;
  suggestedEdits: number;
  unassignedOrgs: number;
  discrepancies: number;
}

export function AdminActionCenter({ counts }: { counts: AdminQueueCounts }) {
  const queues = [
    {
      title: "Unassigned Clients",
      count: counts.unassignedOrgs,
      href: "/clients?owner=unassigned",
      description: "Imported clients awaiting an owner",
      urgent: counts.unassignedOrgs > 0,
    },
    {
      title: "Ownership Requests",
      count: counts.ownershipRequests,
      href: "/admin/ownership-requests",
      description: "CAMs requesting to take over clients",
      urgent: counts.ownershipRequests > 0,
    },
    {
      title: "Pending Suppressions",
      count: counts.pendingSuppressions,
      href: "/admin/suppressions",
      description: "Charities awaiting suppression approval",
      urgent: counts.pendingSuppressions > 0,
    },
    {
      title: "Suggested Edits",
      count: counts.suggestedEdits,
      href: "/admin/edit-suggestions",
      description: "Proposed changes to restricted fields",
      urgent: counts.suggestedEdits > 0,
    },
    {
      title: "Data Discrepancies",
      count: counts.discrepancies,
      href: "/admin/discrepancies",
      description: "Conflicts from automated ingestion",
      urgent: counts.discrepancies > 0,
    },
  ];

  const totalActions = queues.reduce((sum, q) => sum + q.count, 0);

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="p-6 border-b border-black/[0.06] flex items-baseline justify-between">
        <h3 className="font-semibold text-lg">Admin Duty Queue</h3>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
          {totalActions} Action{totalActions !== 1 ? 's' : ''} Needed
        </span>
      </div>
      
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x border-black/[0.06]">
        {queues.map((queue, i) => (
          <Link
            key={queue.title}
            href={queue.href}
            className={cn(
              "group p-6 flex flex-col hover:bg-black/[0.02] transition-colors border-b sm:border-b-0 border-black/[0.06]",
              (i === 0 || i === 1 || i === 2) && "border-b",
              (i === 3 || i === 4) && "sm:border-t"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{queue.title}</span>
              {queue.count > 0 ? (
                <span className="flex items-center justify-center h-6 min-w-[24px] px-2 rounded-full bg-brand text-brand-foreground font-bold text-xs">
                  {queue.count}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs font-semibold">0</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-auto">
              {queue.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
