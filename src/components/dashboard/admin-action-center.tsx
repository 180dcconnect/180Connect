"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { topDutyQueues } from "@/lib/dashboard/admin-queue-order.ts";

export interface AdminQueueCounts {
  pendingSuppressions: number;
  ownershipRequests?: number;
  incompleteRecords: number;
  suggestedEdits: number;
  /**
   * High-priority clients with no owner — **not** the whole unowned pool.
   *
   * The pool is thousands on staging and grows with every import, so counting
   * it here made this tile read "urgent" permanently, which is how a duty queue
   * teaches people to ignore it. The number that earns the red badge is the one
   * an admin can act on: high score, nobody owns it. The full pool is still
   * counted on the dashboard, where it is a CAM's way into work when their own
   * book is empty.
   */
  unassignedHighPriorityOrgs: number;
  discrepancies: number;
  statusChanges: number;
  /** Imported records held as possible duplicates of an existing client. */
  duplicates?: number;
}

export function AdminActionCenter({ counts }: { counts: AdminQueueCounts }) {
  // The whole pool of admin workspaces, each with its own screen. Biggest
  // backlog first, zeros filling the rest so there are always six tiles.
  //
  // Deliberately not every Data health Records row: "no website", "no email"
  // and "found details to check" have no workspace of their own and are
  // already counted inside Incomplete Records, and the full unassigned pool
  // (thousands, always rising) would sit at the top forever — which is why
  // the unassigned tile counts the high-priority slice an admin can place.
  const pool = [
    {
      // The href and the count have to describe the same set, or the queue
      // sends an admin to a list of 2,700 to find the 225 it just named. Same
      // two filters the tile is counting: no owner, high score band.
      title: "High-Priority Unassigned Clients",
      count: counts.unassignedHighPriorityOrgs,
      href: "/clients?owner=unassigned&score=high",
      description: "High score, no owner yet",
      urgent: counts.unassignedHighPriorityOrgs > 0,
    },
    {
      // The count and the destination describe the same set: the fix-up
      // workspace lists records missing a mission, a sector, or a website
      // (a hand-written enrichment mission counts, same as the tile).
      title: "Incomplete Records",
      count: counts.incompleteRecords,
      href: "/admin/incomplete-records",
      description: "Missing or redacted mission, sector, website, email, or city — fix them inline",
      urgent: counts.incompleteRecords > 0,
    },
    {
      title: "Pending Suppressions",
      count: counts.pendingSuppressions,
      href: "/admin/suppressions",
      description: "Charities awaiting suppression approval",
      urgent: counts.pendingSuppressions > 0,
    },
    {
      title: "Ownership Requests",
      count: counts.ownershipRequests ?? 0,
      href: "/admin/ownership-requests",
      description: "CAMs asking for a client another CAM owns",
      urgent: (counts.ownershipRequests ?? 0) > 0,
    },
    {
      title: "Possible Duplicates",
      count: counts.duplicates ?? 0,
      href: "/admin/duplicates",
      description: "Imported records that may already be clients — decide whether to merge",
      urgent: (counts.duplicates ?? 0) > 0,
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
    {
      title: "Register Status Changes",
      count: counts.statusChanges,
      href: "/admin/review",
      description: "Clients whose Charity Commission or Companies House status changed",
      urgent: counts.statusChanges > 0,
    },
  ];

  const queues = topDutyQueues(pool);

  const totalActions = pool.reduce((sum, q) => sum + q.count, 0);
  const hiddenQueues = pool.filter((q) => q.count > 0 && !queues.includes(q));
  const hiddenActions = hiddenQueues.reduce((sum, q) => sum + q.count, 0);

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="p-6 border-b border-black/[0.06] flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-lg">Admin Duty Queue</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Biggest backlog first — always the top six.
          </p>
        </div>
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
          {totalActions} Action{totalActions !== 1 ? 's' : ''} Needed
        </span>
      </div>
      
      {/* Hairlines come from the 1px gap showing the grid's own fill, so every
          row and column divides cleanly however many queues there are. */}
      <div className="grid gap-px bg-black/[0.06] sm:grid-cols-2 lg:grid-cols-3">
        {queues.map((queue) => (
          <Link
            key={queue.title}
            href={queue.href}
            className={cn(
              "group p-6 flex flex-col bg-white hover:bg-[#fafafa] transition-colors"
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
      {hiddenActions > 0 && (
        <p className="border-b border-black/[0.06] bg-[#fafafa] px-6 py-2.5 text-[13px] text-muted-foreground">
          Plus {hiddenActions.toLocaleString()} more action{hiddenActions !== 1 ? "s" : ""} in{" "}
          {hiddenQueues.length} other {hiddenQueues.length === 1 ? "queue" : "queues"}:{" "}
          {hiddenQueues.map((q) => q.title).join(" · ")}. Clear the biggest backlog first.
        </p>
      )}
            <p className="text-sm text-muted-foreground mt-auto">
              {queue.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
