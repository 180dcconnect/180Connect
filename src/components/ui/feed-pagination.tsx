"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
        <div className="flex items-center gap-1.5 text-[12px] text-foreground">
          <span>Show</span>
          <Select
            value={String(pageSize)}
            onValueChange={(val) => {
              onPageSizeChange(Number(val));
              onPageChange(1);
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-6 w-auto min-w-[44px] gap-1 rounded-md border border-black/[0.08] bg-white px-2 py-0 text-[12px] font-semibold text-foreground shadow-2xs hover:bg-black/5 dark:border-white/10 dark:bg-card dark:hover:bg-white/10"
              aria-label="Items per page"
            >
              <SelectValue placeholder={String(pageSize)} />
            </SelectTrigger>
            <SelectContent align="start" className="min-w-[4.5rem]">
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[12px] font-medium text-foreground">per page</span>
        </div>

        <span className="hidden h-3 w-px bg-black/[0.08] dark:bg-white/[0.1] sm:inline-block" />
        <span className="text-[12px] font-medium text-foreground">
          Showing <span className="font-semibold text-foreground">{from}–{to}</span> of{" "}
          <span className="font-semibold text-foreground">{totalItems}</span>
        </span>

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
