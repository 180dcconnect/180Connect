"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { FormattedRecentUpdate, ActorPreview, OrganisationPreview } from "@/lib/recent-updates";
import { FeedPagination } from "@/components/ui/feed-pagination";
import { UserHoverCard } from "@/components/user-hover-card";
import { OrganisationHoverCard } from "@/components/organisation-hover-card";

/**
 * F028 — the dashboard's Recent Updates feed: a platform-wide, chronological
 * list of what changed on which client (client edits and timeline events),
 * scoped to a recent window by @/lib/recent-updates.ts.
 *
 * Includes client-side instant pagination with stable height to prevent layout shift.
 */

function badgeStyleFor(label: string): string {
  // Toned-down pills — muted enough for the white card, still one hue per
  // event type so the right edge stays scannable without reading.
  switch (label) {
    case "Email sent":
      return "bg-brand/10 text-brand border-brand/20 dark:bg-brand/15 dark:text-brand dark:border-brand/20";
    case "Reply received":
      return "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20";
    case "Note added":
      return "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";
    case "Note edited":
      return "bg-white text-zinc-600 border-zinc-200 dark:bg-white/5 dark:text-zinc-400 dark:border-white/10";
    case "Status changed":
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20";
    case "Ownership changed":
      return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/20";
    case "Suggested edit applied":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20";
    case "Suggested edit rejected":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20";
    default:
      return "bg-black/[0.05] text-foreground/60 border-black/[0.05] dark:bg-white/[0.08] dark:text-foreground/70 dark:border-white/[0.08]";
  }
}

export function RecentUpdatesFeed({ items }: { items: FormattedRecentUpdate[] }) {
  const [pageSize, setPageSize] = useState<number>(5);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const visibleItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  const startIndex = (safePage - 1) * pageSize;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm dark:border-white/[0.08] dark:bg-card">
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-foreground/55">
          No recent updates yet.
        </p>
      ) : (
        <>
          {/* Stable content container preserving exact height across pages */}
          <div
            className="flex-1 transition-[height] duration-200 ease-out"
            style={{
              height: `${pageSize * 84}px`,
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.ul
                key={`page-${safePage}-${pageSize}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="divide-y divide-black/[0.06] dark:divide-white/[0.08]"
              >
                {visibleItems.map((item, index) => {
                  const globalIndex = startIndex + index;
                  const actorPreview = item.actorPreview;
                  const orgPreview = item.orgPreview;
                  const content = (
                    <>
                      <span
                        aria-hidden="true"
                        className="w-6 shrink-0 text-[11px] font-bold tabular-nums text-foreground/25 dark:text-foreground/35"
                      >
                        {String(globalIndex + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 truncate text-[14px] leading-snug text-foreground">
                          {actorPreview ? (
                            <UserHoverCard user={actorPreview} className="font-semibold" />
                          ) : (
                            <span className="font-semibold">{item.subjectName}</span>
                          )}{" "}
                          <span className="text-foreground/70 dark:text-foreground/80">{item.actionPhrase}</span>
                          {item.mentionsClient && (
                            <>
                              {" "}
                              {orgPreview ? (
                                <OrganisationHoverCard org={orgPreview} className="font-bold" />
                              ) : (
                                <span className="font-bold">{item.orgName}</span>
                              )}
                            </>
                          )}
                        </p>
                        <p className="mt-0.5 line-clamp-1 truncate text-[12px] text-foreground/45 dark:text-foreground/55">
                          {item.summary}
                        </p>
                        <p className="mt-0.5 text-[11px] text-foreground/40 dark:text-foreground/50">
                          {item.relativeTime}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${badgeStyleFor(item.eventLabel)}`}
                      >
                        {item.eventLabel}
                      </span>
                      <span
                        aria-hidden="true"
                        className="shrink-0 text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55 dark:text-foreground/35 dark:group-hover:text-foreground/75"
                      >
                        →
                      </span>
                    </>
                  );

                  return (
                    <li key={item.id} className="h-[84px]">
                      <Link
                        href={item.href}
                        className="group flex h-full items-center gap-4 px-5 py-3 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand dark:hover:bg-white/[0.03]"
                      >
                        {content}
                      </Link>
                    </li>
                  );
                })}
              </motion.ul>
            </AnimatePresence>
          </div>

          <FeedPagination
            totalItems={items.length}
            pageSize={pageSize}
            currentPage={safePage}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[5, 10]}
          />
        </>
      )}
    </div>
  );
}

export default RecentUpdatesFeed;
