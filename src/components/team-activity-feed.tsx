import Link from "next/link";
import type { FormattedTeamActivity } from "@/lib/team-activity";

/**
 * F029 — the dashboard's Recent Team Activity feed: shows recent actions taken
 * by other team members, attributed by real name (AC1/AC2), in reverse-chronological
 * order so the team stays coordinated.
 *
 * Styled consistently with AttentionList and the 180Connect design system:
 * a white card with subtle borders floating on the page ground, tabular index
 * markers, action pills, relative timestamps, and hover link indicators.
 */
export function TeamActivityFeed({ items }: { items: FormattedTeamActivity[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-foreground/55">
          No recent team activity yet.
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
                  <p className="text-[14px] leading-snug font-medium text-foreground">
                    <span className="font-bold text-foreground">{item.actorName}</span>{" "}
                    {item.sentence.replace(new RegExp(`^${item.actorName}\\s*`), "")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-foreground/40">
                    {item.relativeTime}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/55">
                  {item.actionLabel}
                </span>
                {item.targetHref && (
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55"
                  >
                    →
                  </span>
                )}
              </>
            );

            return (
              <li key={item.id}>
                {item.targetHref ? (
                  <Link
                    href={item.targetHref}
                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center gap-4 px-5 py-4">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
