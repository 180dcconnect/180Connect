import Link from "next/link";
import { myWorkHref, type MyWorkSummary } from "@/lib/dashboard/my-work";

/**
 * F206 — "My work": the first thing on the dashboard, above the platform
 * totals, because the platform totals are not something one person can act on.
 *
 * Four counts, each a link into the client list with the same filter that
 * produced the number, so the tile is a door rather than a fact. No sparklines
 * and no deltas: these are "what is on my desk right now" readings, and a
 * week-on-week arrow on "not yet contacted" would imply a trend where there is
 * only a queue. The trend view of the same work is the Performance section's
 * "Just me" scope, further down.
 *
 * A server component — the counts come from rows the page already has, and
 * nothing here changes without a navigation.
 */
export function MyWorkStrip({
  summary,
  actorId,
}: {
  summary: MyWorkSummary;
  actorId: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {summary.buckets.map((bucket) => {
        // The three action buckets read as work when they are non-zero; the
        // total is a standing figure and never wants the emphasis.
        const active = bucket.key !== "owned" && bucket.count > 0;
        return (
          <Link
            key={bucket.key}
            href={myWorkHref(bucket, actorId)}
            className="group flex flex-col justify-between gap-6 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm transition-colors hover:bg-black/[0.015] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand dark:border-white/[0.08] dark:bg-card"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              {bucket.label}
            </p>
            <div className="flex items-end justify-between gap-3">
              <span
                className={`text-[2rem] font-black leading-none tracking-[-0.03em] tabular-nums ${
                  active ? "text-foreground" : "text-foreground/70"
                }`}
              >
                {bucket.count.toLocaleString()}
              </span>
              <span
                aria-hidden="true"
                className="pb-1 text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55"
              >
                →
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default MyWorkStrip;
