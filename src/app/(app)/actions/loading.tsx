import { Skeleton } from "@/components/ui/skeleton";

import { ActionsHeader } from "./actions-header";

/**
 * Mirrors page.tsx: bone ground, the `max-w-3xl` column, the real Actions
 * header (title and tab row are static, so drawn once and never guessed at),
 * then the task list.
 *
 * Without this file a click on "Actions" showed nothing until the server had
 * finished, because Next cannot prefetch a page rendered per request.
 * Approximated because it is data: how many actions are outstanding.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-paper px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <ActionsHeader current="/actions">
            <p className="mt-3 font-body text-sm leading-[1.7] text-dim">
              Outstanding work assigned to you, overdue first. Mark a task complete to
              remove it from this list — it stays on record.
            </p>
          </ActionsHeader>
        </div>

        <div aria-hidden="true" className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-4 rounded-2xl border border-black/[0.06] bg-white px-5 py-4 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="mt-1.5 h-4 w-40 max-w-full" />
              </div>
              <Skeleton className="h-9 w-28 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
