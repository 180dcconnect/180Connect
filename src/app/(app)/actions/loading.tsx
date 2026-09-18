import { Skeleton } from "@/components/ui/skeleton";

import { ActionsHeader } from "./actions-header";

/**
 * Mirrors page.tsx: bone ground, the standard app shell, the real Actions
 * header (title and tab row are static, so drawn once and never guessed at),
 * then the task list.
 *
 * Without this file a click on "Actions" showed nothing until the server had
 * finished, because Next cannot prefetch a page rendered per request.
 * Approximated because it is data: how many actions are outstanding.
 */
export default function Loading() {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <div>
          <ActionsHeader current="/actions">
            <p className="mt-3 font-body text-sm leading-[1.7] text-dim">
              Outstanding work assigned to you, overdue first. Mark a task complete to
              remove it from this list — it stays on record.
            </p>
          </ActionsHeader>
        </div>

        <div aria-hidden="true" className="space-y-6">
          <div>
            <Skeleton className="h-6 w-28" />
            <div className="mt-2 overflow-hidden rounded-panel border border-rule bg-white">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-4 border-b border-rule-soft px-5 py-4 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-5 w-56 max-w-full" />
                    <Skeleton className="mt-1.5 h-4 w-40 max-w-full" />
                  </div>
                  <Skeleton className="h-8.5 w-28 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
