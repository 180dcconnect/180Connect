import { Skeleton } from "@/components/ui/skeleton";

import { ActionsHeader } from "../../actions/actions-header";

/**
 * Mirrors page.tsx's shell: bone ground, the real Actions header (title and
 * tab row are static, so drawn once and never guessed at), then the assign
 * form card and the outstanding/completed sections.
 *
 * Approximated because it is data: how many actions are outstanding or
 * completed, and whether any read failed.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-4xl space-y-8">
        <div>
          <ActionsHeader current="/admin/actions">
            <Skeleton className="mt-3 h-4 w-full max-w-xl" />
            <Skeleton className="mt-2 h-4 w-2/3 max-w-xl" />
          </ActionsHeader>
        </div>

        <div aria-hidden="true" className="space-y-8">
          {/* Assign form card */}
          <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
            <Skeleton className="h-[25px] w-44" />
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div key={index}>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-1.5 h-10 w-full rounded-lg" />
                  </div>
                ))}
              </div>
              <div>
                <Skeleton className="h-4 w-36" />
                <Skeleton className="mt-1.5 h-10 w-full rounded-lg" />
              </div>
              <div>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1.5 h-16 w-full rounded-lg" />
              </div>
              <div>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1.5 h-10 w-48 rounded-lg" />
              </div>
              <Skeleton className="h-9 w-32 rounded-full" />
            </div>
          </section>

          {/* Outstanding + completed */}
          {(["Outstanding", "Completed"] as const).map((heading) => (
            <section key={heading}>
              <Skeleton className="ml-1 h-4 w-36" />
              <div className="mt-3 space-y-3">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div
                    key={index}
                    className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Skeleton className="h-5 w-48 max-w-full" />
                      <Skeleton className="h-6 w-24 rounded-full" />
                    </div>
                    <Skeleton className="mt-2 h-4 w-64 max-w-full" />
                    <Skeleton className="mt-1.5 h-4 w-40 max-w-full" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
