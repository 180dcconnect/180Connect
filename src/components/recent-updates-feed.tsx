import Link from "next/link";
import type { FormattedRecentUpdate } from "@/lib/recent-updates";

/**
 * F028 — the dashboard's Recent Updates feed: a platform-wide, chronological
 * list of what changed on which client (client edits and timeline events),
 * scoped to a recent window by @/lib/recent-updates.ts.
 *
 * Styled consistently with TeamActivityFeed and AttentionList: a white card
 * with subtle borders floating on the page ground, tabular index markers, an
 * event pill, relative timestamps, and hover link indicators. Each row links
 * straight to the client it happened on.
 */
export function RecentUpdatesFeed({ items }: { items: FormattedRecentUpdate[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-foreground/55">
          No recent updates yet.
        </p>
      ) : (
        <ul className="divide-y divide-black/[0.06]">
          {items.map((item, index) => {
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className="w-6 shrink-0 text-[11px] font-bold tabular-nums text-foreground/25"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  {/* Reads as a sentence in natural order: who did what, and
                      to which client — no jumping to the pill to learn the
                      action. For a client reply the client itself is the
                      subject ("Acme Ltd replied to your outreach"). */}
                  <p className="line-clamp-2 text-[14px] leading-snug text-foreground">
                    <span className="font-semibold">{item.subjectName}</span>{" "}
                    <span className="text-foreground/70">{item.actionPhrase}</span>
                    {item.mentionsClient && (
                      <>
                        {" "}
                        <span className="font-bold">{item.orgName}</span>
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-[12px] text-foreground/45">
                    {item.summary}
                  </p>
                  <p className="mt-0.5 text-[11px] text-foreground/40">
                    {item.relativeTime}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/55">
                  {item.eventLabel}
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55"
                >
                  →
                </span>
              </>
            );

            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                >
                  {content}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
