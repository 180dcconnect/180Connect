"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { FormattedTeamActivity } from "@/lib/team-activity";
import { FeedPagination } from "@/components/ui/feed-pagination";

/**
 * F029 — the dashboard's Recent Team Activity feed: shows recent actions taken
 * by other team members, attributed by real name (AC1/AC2), in reverse-chronological
 * order so the team stays coordinated.
 *
 * Includes client-side instant pagination with stable height to prevent layout shift.
 */
export function TeamActivityFeed({ items }: { items: FormattedTeamActivity[] }) {
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
          No recent team activity yet.
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
                        <p className="text-[14px] leading-snug font-medium text-foreground">
                          {item.sentence.startsWith(item.actorName) ? (
                            <>
                              <span className="font-bold text-foreground">{item.actorName}</span>
                              {item.sentence.slice(item.actorName.length)}
                            </>
                          ) : (
                            <span>{item.sentence}</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[11px] text-foreground/40 dark:text-foreground/50">
                          {item.relativeTime}
                        </p>
                      </div>
                      {item.actionButton ? (
                        <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand transition-colors group-hover:bg-brand/20">
                          {item.actionButton.label}
                          <span
                            aria-hidden="true"
                            className="transition-transform duration-200 group-hover:translate-x-0.5"
                          >
                            →
                          </span>
                        </span>
                      ) : (
                        <>
                          <span className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/55 dark:bg-white/[0.08] dark:text-foreground/70">
                            {item.actionLabel}
                          </span>
                          {item.targetHref && (
                            <span
                              aria-hidden="true"
                              className="shrink-0 text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55 dark:text-foreground/35 dark:group-hover:text-foreground/75"
                            >
                              →
                            </span>
                          )}
                        </>
                      )}
                    </>
                  );

                  return (
                    <li key={item.id}>
                      {item.targetHref ? (
                        <Link
                          href={item.targetHref}
                          className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand dark:hover:bg-white/[0.03]"
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

export default TeamActivityFeed;
