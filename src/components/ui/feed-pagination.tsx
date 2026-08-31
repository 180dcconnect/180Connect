"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export interface FeedPaginationProps {
  totalItems: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export function getPageNumbers(currentPage: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, "...", totalPages];
  }

  if (currentPage >= totalPages - 2) {
    return [1, "...", totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
}

export function FeedPagination({
  totalItems,
  pageSize,
  currentPage,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [5, 10],
  className = "",
}: FeedPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalItems);

  if (totalItems <= Math.min(...pageSizeOptions) && totalPages <= 1) {
    return null;
  }

  const pages = getPageNumbers(currentPage, totalPages);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] bg-black/[0.015] px-5 py-3 dark:border-white/[0.08] dark:bg-white/[0.02] ${className}`}
    >
      {/* Left: Summary & Per Page Toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-medium text-foreground/45">
          Showing <span className="font-semibold text-foreground/75">{from}–{to}</span> of{" "}
          <span className="font-semibold text-foreground/75">{totalItems}</span>
        </span>

        <span className="hidden h-3 w-px bg-black/[0.08] dark:bg-white/[0.1] sm:inline-block" />

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-foreground/45">Show:</span>
          {pageSizeOptions.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => {
                onPageSizeChange(size);
                onPageChange(1);
              }}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-all ${
                pageSize === size
                  ? "bg-foreground text-background shadow-xs dark:bg-white dark:text-slate-900"
                  : "text-foreground/50 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Page Navigation */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-foreground/70 transition-colors hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/10"
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
            <span className="hidden xs:inline">Prev</span>
          </button>

          <div className="flex items-center gap-1">
            {pages.map((p, idx) =>
              p === "..." ? (
                <span key={`ellipsis-${idx}`} className="px-1 text-xs text-foreground/30">
                  …
                </span>
              ) : (
                <button
                  key={`page-${p}`}
                  type="button"
                  onClick={() => onPageChange(p as number)}
                  className={`flex h-7 min-w-[28px] items-center justify-center rounded-lg px-1.5 text-xs font-semibold transition-colors ${
                    currentPage === p
                      ? "bg-foreground text-background shadow-xs dark:bg-white dark:text-slate-900"
                      : "text-foreground/60 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                  }`}
                >
                  {p}
                </button>
              )
            )}
          </div>

          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-foreground/70 transition-colors hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/10"
            aria-label="Next page"
          >
            <span className="hidden xs:inline">Next</span>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export default FeedPagination;
