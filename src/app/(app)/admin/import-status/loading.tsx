import { Skeleton } from "@/components/ui/skeleton";
import { DataImportsHeader } from "../data-imports-header";

/**
 * Mirrors page.tsx's shell: bone ground, a `SearchRail` column, then the
 * ingestion guide and the run feed.
 *
 * Rebuilt because the old version reserved `lg:pr-[472px]` on the whole column
 * and drew the feed as a bare `h-40 rounded-2xl` slab. `SearchRail` reserves the
 * bar's width on the **heading** only — the bar rides its own absolutely
 * positioned rail, and the content below it is full width — so the reserve on the
 * column narrowed the feed by 472px against the real page, and the slab was a
 * dark block where a white card of rows belongs.
 *
 * The header inside the rail is `DataImportsHeader`, rendered for real: its mark,
 * title and tab row are static, so a bar standing in for it would be a worse lie
 * than the thing itself.
 *
 * Approximated because it is data: how many runs, how they group, whether the
 * page shows the load-failed alert, and whether anything is staged at all.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="relative mx-auto w-full max-w-6xl">
        <div className="pointer-events-none absolute inset-x-0 -top-1.5 bottom-0 z-40 lg:-top-2.5">
          <div className="sticky top-3 flex justify-end lg:top-3.5">
            <div className="w-full lg:w-[440px]">
              <Skeleton className="h-16 w-full rounded-full" />
            </div>
          </div>
        </div>

        <div className="space-y-10">
          <div className="pt-[76px] lg:pt-0 lg:pr-[472px]">
            <DataImportsHeader current="/admin/import-status">
              <div className="mt-3 max-w-xl space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/5" />
              </div>
            </DataImportsHeader>
          </div>

          <div className="space-y-6">
            {/* Ingestion guide — a collapsible heading, closed */}
            <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-xs">
              <div className="flex w-full items-center justify-between gap-4 px-5 py-4 sm:px-6">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-5 shrink-0" />
              </div>
            </div>

            {/* The count line, then a day of runs */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <Skeleton className="h-4 w-80 max-w-full" />
              <Skeleton className="h-4 w-40" />
            </div>

            {Array.from({ length: 2 }).map((_, groupIndex) => (
              <div key={groupIndex} className="space-y-2.5">
                <Skeleton className="h-4 w-32" />
                <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <li key={index} className="flex items-start gap-4 px-5 py-4">
                      <Skeleton className="mt-0.5 size-6 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1">
                        <Skeleton className="h-5 w-1/2 max-w-full" />
                        <Skeleton className="mt-1.5 h-4 w-64 max-w-full" />
                      </div>
                      <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
