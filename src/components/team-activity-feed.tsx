"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { FormattedTeamActivity, ActorPreview, OrganisationPreview } from "@/lib/team-activity";
import { FeedPagination } from "@/components/ui/feed-pagination";
import { BackButton } from "@/components/ui/back-button";
import { UserHoverCard } from "@/components/user-hover-card";
import { OrganisationHoverCard } from "@/components/organisation-hover-card";

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
          {/* Stable content container preserving exact height across pages */}
          <div
            className="flex-1 transition-[height] duration-200 ease-out"
            style={{
              height: `${pageSize * 72}px`,
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
                    const hasAction = Boolean(item.actionButton?.href || item.targetHref);
                    const backHref = item.actionButton?.href ?? item.targetHref ?? undefined;
                    const backLabel = "View";
                    const actorPreview = item.actorPreview;
                    const targetOrgPreview = item.targetOrgPreview;

                    return (
                      <li key={item.id} className="h-[72px]">
                        <div className="flex h-full items-center gap-4 px-5 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                          <span
                            aria-hidden="true"
                            className="w-6 shrink-0 text-[11px] font-bold tabular-nums text-foreground/25 dark:text-foreground/35"
                          >
                            {String(globalIndex + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-1 truncate text-[14px] leading-snug font-medium text-foreground">
                              {item.sentence.startsWith(item.actorName) ? (
                                <>
                                  {actorPreview ? (
                                    <UserHoverCard user={actorPreview} className="font-bold text-foreground" />
                                  ) : (
                                    <span className="font-bold text-foreground">{item.actorName}</span>
                                  )}
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
                          {hasAction && backHref ? (
                            <BackButton
                              href={backHref}
                              label={backLabel}
                              variant="sliding-door-right"
                              size="sm"
                              tone="dark"
                              aria-label={`${backLabel}: ${item.sentence}`}
                              className="shrink-0"
                            />
                          ) : null}
                        </div>
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
