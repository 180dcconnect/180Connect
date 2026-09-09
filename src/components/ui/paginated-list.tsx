"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50];

/**
 * Generic paginated list wrapper. Renders its children (the full list) and
 * adds a footer with page-size selector and page navigation. The consumer
 * passes a flat <ul> or similar element; this component slices the data and
 * passes only the visible slice via the `render` prop.
 */
export function PaginatedList<T>({
  items,
  initialPageSize = 10,
  className,
  render,
}: {
  items: T[];
  /** Default page size. User can override via the dropdown. */
  initialPageSize?: number;
  className?: string;
  /** Render function receiving the visible slice of items. */
  render: (visibleItems: T[]) => React.ReactNode;
}) {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  // Clamp page if shrinking page size pushed us past the end.
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const visible = items.slice(start, start + pageSize);

  return (
    <div className={cn("space-y-3", className)}>
      {render(visible)}

      {items.length > PAGE_SIZE_OPTIONS[0] && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule-soft pt-3 text-[12.5px]">
          <div className="flex items-center gap-2 text-dim">
            <span>Showing {visible.length} of {items.length}</span>
            <span aria-hidden="true" className="text-rule">·</span>
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Items per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(0);
                }}
              >
                <SelectTrigger className="h-7 w-auto min-w-[70px] rounded-full border-rule bg-white px-2.5 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} per page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded px-2 py-1 text-[12px] font-medium text-dim hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="px-2 text-[12px] tabular-nums text-faint">
                {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                className="rounded px-2 py-1 text-[12px] font-medium text-dim hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
