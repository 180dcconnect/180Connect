import Link from "next/link";

import { Pill } from "@/app/clients/[id]/section-card";

/**
 * F181 — the admin duty queue, as a reading rather than a link.
 *
 * The admin dashboard's header used to point at `/admin/review` with a bare
 * pill: an admin landing on their own home page could not tell whether anything
 * was waiting, while the *CAM* dashboard printed the counts. This is the same
 * numbers on the screen where they belong.
 *
 * The counts arrive already tallied (`fetchAdminQueueTally`), so this component
 * holds no queries and can be rendered from a server page. `unassignedOrgs` is
 * passed in by the caller, which already holds the organisation rows it comes
 * from.
 *
 * A card rather than a pill with a number on it because each queue needs its
 * own door — "7 items need you" is only actionable if you can see which seven.
 * Wording matches `AdminActionCenter`'s rows, which lists the same five queues
 * on the CAM dashboard: two screens naming one queue two ways is how an admin
 * learns to distrust both.
 */
export type DutyQueueCounts = {
  pendingSuppressions: number;
  ownershipRequests: number;
  suggestedEdits: number;
  discrepancies: number;
  unassignedOrgs: number;
};

export function DutyQueueCard({ counts }: { counts: DutyQueueCounts }) {
  const queues = [
    {
      label: "Unassigned clients",
      count: counts.unassignedOrgs,
      href: "/clients?owner=unassigned",
      hint: "Imported clients awaiting an owner",
    },
    {
      label: "Ownership requests",
      count: counts.ownershipRequests,
      href: "/admin/ownership-requests",
      hint: "CAMs requesting to take over clients",
    },
    {
      label: "Pending suppressions",
      count: counts.pendingSuppressions,
      href: "/admin/suppressions",
      hint: "Charities awaiting suppression approval",
    },
    {
      label: "Suggested edits",
      count: counts.suggestedEdits,
      href: "/admin/edit-suggestions",
      hint: "Proposed changes to restricted fields",
    },
    {
      label: "Data discrepancies",
      count: counts.discrepancies,
      href: "/admin/discrepancies",
      hint: "Conflicts raised by automated ingestion",
    },
  ];

  const total = queues.reduce((sum, queue) => sum + queue.count, 0);

  return (
    <section
      aria-labelledby="duty-queue-heading"
      className="rounded-panel border border-rule bg-white"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
        <h2
          id="duty-queue-heading"
          className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
        >
          Duty queue
        </h2>
        <Pill tone={total > 0 ? "lead" : "neutral"} dot={false}>
          {total > 0 ? `${total.toLocaleString()} open` : "Clear"}
        </Pill>
      </div>

      <ul className="divide-y divide-rule-soft border-t border-rule-soft">
        {queues.map((queue) => (
          <li key={queue.label}>
            <Link
              href={queue.href}
              className="flex items-center justify-between gap-4 px-5 py-2.5 transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead"
            >
              <span className="min-w-0">
                <span className="block font-body text-[13.5px] font-medium text-ink">
                  {queue.label}
                </span>
                <span className="mt-0.5 block font-body text-[12.5px] leading-[1.45] text-dim">
                  {queue.hint}
                </span>
              </span>
              <span
                className={`shrink-0 font-body text-[18px] leading-none font-semibold tabular-nums ${
                  queue.count > 0 ? "text-ink" : "text-faint"
                }`}
              >
                {queue.count.toLocaleString()}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default DutyQueueCard;
