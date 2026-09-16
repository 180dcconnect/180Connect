"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DashboardFeedItem } from "@/lib/dashboard/recent-feed";
import { FeedPagination } from "@/components/ui/feed-pagination";
import { BackButton } from "@/components/ui/back-button";
import { UserHoverCard } from "@/components/user-hover-card";
import { OrganisationHoverCard } from "@/components/organisation-hover-card";

/**
 * F028/F029 — the dashboard's Recent updates feed: what changed on clients and
 * what the team did, in one newest-first list (merged by
 * @/lib/dashboard/recent-feed.ts, which also drops the moves both sources used
 * to report twice).
 *
 * A row that has somewhere to go carries a "View" button; a row that doesn't
 * (a team event with no client or profile behind it) carries none, rather than
 * a button that opens nothing useful.
 *
 * Client-side pagination with a fixed row height, so paging never shifts the
 * page below it.
 */
const ROW_HEIGHT = 84;

export function RecentUpdatesFeed({ items }: { items: DashboardFeedItem[] }) {
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
    <div className="flex flex-col overflow-hidden rounded-panel border border-rule bg-white">
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center font-body text-sm text-dim">No recent updates yet.</p>
      ) : (
        <>
          <div
            className="flex-1 transition-[height] duration-200 ease-out"
            style={{ height: `${pageSize * ROW_HEIGHT}px` }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.ul
                key={`page-${safePage}-${pageSize}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="divide-y divide-rule-soft"
              >
                {visibleItems.map((item, index) => (
                  <li key={item.id} style={{ height: ROW_HEIGHT }}>
                    <div className="flex h-full items-center gap-4 px-5 py-3">
                      <span
                        aria-hidden="true"
                        className="w-6 shrink-0 font-body text-[11px] font-bold tabular-nums text-faint"
                      >
                        {String(startIndex + index + 1).padStart(2, "0")}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body text-[14px] leading-snug text-ink">
                          {item.subjectName &&
                            (item.subjectPreview ? (
                              <UserHoverCard user={item.subjectPreview} className="font-semibold" />
                            ) : (
                              <span className="font-semibold">{item.subjectName}</span>
                            ))}{" "}
                          <span className="text-dim">{item.phrase}</span>
                          {item.clientName && (
                            <>
                              {" "}
                              {item.clientPreview ? (
                                <OrganisationHoverCard org={item.clientPreview} className="font-bold" />
                              ) : (
                                <span className="font-bold">{item.clientName}</span>
                              )}
                            </>
                          )}
                        </p>
                        {item.summary && (
                          <p className="mt-0.5 truncate font-body text-[12px] text-dim">{item.summary}</p>
                        )}
                        <p className="mt-0.5 font-body text-[11px] text-faint">{item.relativeTime}</p>
                      </div>

                      <span className="hidden shrink-0 rounded-inset bg-paper px-2 py-1 font-body text-[11.5px] font-semibold text-dim sm:inline">
                        {item.eventLabel}
                      </span>

                      {item.href && (
                        <BackButton
                          href={item.href}
                          label="View"
                          variant="sliding-door-right"
                          size="sm"
                          tone="dark"
                          aria-label={`View: ${[item.subjectName, item.phrase, item.clientName].filter(Boolean).join(" ")}`}
                          className="shrink-0"
                        />
                      )}
                    </div>
                  </li>
                ))}
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
