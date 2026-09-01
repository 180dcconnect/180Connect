import Link from "next/link";
import type { ReplyQueueSummary } from "@/lib/dashboard/reply-queue";

/**
 * The reply queue — client replies sitting unanswered, and the oldest one.
 *
 * Nothing on the dashboard pointed at the inbox, so an unanswered reply was
 * only visible to someone who thought to go and look. That is the most
 * expensive silence on the platform: the client did the hard part.
 *
 * The headline is the CAM's own count, because that is the number they can do
 * something about; the team figure sits under it as context, and is the number
 * an admin is actually reading. The age of the oldest reply is given because
 * "3 waiting" and "3 waiting, oldest 11 days" are different situations.
 */
export function ReplyQueueCard({
  summary,
  isAdmin,
}: {
  summary: ReplyQueueSummary;
  isAdmin: boolean;
}) {
  const stale = summary.myOldestDaysWaiting !== null && summary.myOldestDaysWaiting >= 3;
  const visible = summary.myClients.slice(0, 4);
  const hidden = summary.mine - visible.length;

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm dark:border-white/[0.08] dark:bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-5">
        <h3 className="text-[16px] font-semibold tracking-tight text-foreground">
          Waiting on your reply
        </h3>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
          {isAdmin ? `${summary.team} across the team` : "Inbox"}
        </p>
      </div>

      <div className="flex items-end gap-4 px-5 pb-4">
        <span
          className={`text-[2.5rem] font-black leading-none tracking-[-0.03em] tabular-nums ${
            summary.mine > 0 ? "text-foreground" : "text-foreground/40"
          }`}
        >
          {summary.mine}
        </span>
        <div className="pb-1 text-[12px] leading-[1.5] text-foreground/55">
          <p>
            {summary.mine === 1 ? "client has replied" : "clients have replied"} and is
            waiting on you.
          </p>
          {summary.myOldestDaysWaiting !== null && (
            <p className={stale ? "font-bold text-destructive" : "text-foreground/45"}>
              Oldest: {summary.myOldestDaysWaiting} day
              {summary.myOldestDaysWaiting === 1 ? "" : "s"}.
            </p>
          )}
          {/* Admins see their own number first like everyone else, then the
              team's — the figure they are actually accountable for. */}
          {isAdmin && summary.team !== summary.mine && (
            <p className="text-foreground/45">
              {summary.team} waiting across the whole team.
            </p>
          )}
        </div>
      </div>

      {visible.length > 0 && (
        <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
          {visible.map((client) => (
            <li key={client.organisationId}>
              <Link
                href={`/inbox/${client.organisationId}`}
                className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              >
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold">
                  {client.legalName}
                </span>
                <span className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] tabular-nums text-foreground/55">
                  {client.daysWaiting}d
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/inbox"
        className="mt-auto border-t border-black/[0.06] px-5 py-3 text-[12px] font-bold text-foreground/50 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        {hidden > 0 ? `+${hidden} more — open the inbox →` : "Open the inbox →"}
      </Link>
    </div>
  );
}

export default ReplyQueueCard;
