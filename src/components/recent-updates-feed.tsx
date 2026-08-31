"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { FormattedRecentUpdate } from "@/lib/recent-updates";
import { FeedPagination } from "@/components/ui/feed-pagination";

/**
 * F028 — the dashboard's Recent Updates feed: a platform-wide, chronological
 * list of what changed on which client (client edits and timeline events),
 * scoped to a recent window by @/lib/recent-updates.ts.
 *
 * Includes client-side instant pagination with stable height to prevent layout shift.
 */
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
          {/* Stable content container preserving height across pages to prevent layout shift */}
          <div
            className="flex-1 transition-[min-height] duration-200 ease-out"
            style={{
              minHeight: totalPages > 1 ? `${pageSize * 73}px` : undefined,
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.ul
                key={`page-${safePage}-${pageSize}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="divide-y divide-black/[0.06] dark:divide-white/[0.08]"
              >
                {visibleItems.map((item, index) => {
                  const globalIndex = startIndex + index;
                  const content = (
                    <>
                      <span
                        aria-hidden="true"
                        className="w-6 shrink-0 text-[11px] font-bold tabular-nums text-foreground/25 dark:text-foreground/35"
                      >
                        {String(globalIndex + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[14px] leading-snug text-foreground">
                          <span className="font-semibold">{item.subjectName}</span>{" "}
                          <span className="text-foreground/70 dark:text-foreground/80">{item.actionPhrase}</span>
                          {item.mentionsClient && (
                            <>
                              {" "}
                              <span className="font-bold">{item.orgName}</span>
                            </>
                          )}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-[12px] text-foreground/45 dark:text-foreground/55">
                          {item.summary}
                        </p>
                        <p className="mt-0.5 text-[11px] text-foreground/40 dark:text-foreground/50">
                          {item.relativeTime}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/55 dark:bg-white/[0.08] dark:text-foreground/70">
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
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand dark:hover:bg-white/[0.03]"
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
