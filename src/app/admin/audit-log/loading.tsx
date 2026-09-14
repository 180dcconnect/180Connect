import { Skeleton } from "@/components/ui/skeleton";

/**
 * F234 — mirrors page.tsx's shell: bone ground, a `SearchRail` column, then the
 * feed and its pagination.
 *
 * Rebuilt because the old version put `lg:pr-[472px]` on the *column* and drew
 * the feed as a `SkeletonListPanel`. `SearchRail` reserves the bar's width on the
 * **heading** only — the bar rides an absolutely positioned rail and the list
 * below it is full width — so reserving the whole column pulled the feed 472px
 * narrower than the page's, and every row moved sideways on swap.
 *
 * The bar itself is BrandSearchBar's 64px collapsed row, and the rail is
 * click-through, so it is drawn but not interactive.
 *
 * Approximated because it is data: how many events, how they group by day, and
 * whether the page shows the load-failed alert or the empty state instead.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="relative mx-auto w-full max-w-6xl">
        {/* The sticky bar rail, exactly as `SearchRail` places it */}
        <div className="pointer-events-none absolute inset-x-0 -top-1.5 bottom-0 z-40 lg:-top-2.5">
          <div className="sticky top-3 flex justify-end lg:top-3.5">
            <div className="w-full lg:w-[440px]">
              <Skeleton className="h-16 w-full rounded-full" />
            </div>
          </div>
        </div>

        <div className="space-y-10">
          {/* Heading reserves the rail's width on lg; the feed below does not */}
          <div className="pt-[76px] lg:pr-[472px] lg:pt-0">
            <Skeleton className="h-[1em] w-56 max-w-full text-[clamp(2rem,4vw,2.75rem)] leading-none" />
            <div className="mt-3 max-w-xl space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-11/12" />
            </div>
          </div>

          <div className="space-y-4">
            {/* The count line above the feed */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <Skeleton className="h-4 w-72 max-w-full" />
              <Skeleton className="h-4 w-24" />
            </div>

            {/* One day group: its date heading, then that day's events */}
            {Array.from({ length: 2 }).map((_, groupIndex) => (
              <div key={groupIndex} className="space-y-2.5">
                <Skeleton className="h-4 w-32" />
                <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <li key={index} className="flex items-start gap-4 px-5 py-4">
                      <Skeleton className="mt-0.5 size-8 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1">
                        <Skeleton className="h-5 w-2/3 max-w-full" />
                        <Skeleton className="mt-1.5 h-4 w-48" />
                      </div>
                      <Skeleton className="h-4 w-20 shrink-0" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/* Pagination */}
            <div className="flex items-center justify-between gap-4 pt-2">
              <Skeleton className="h-4 w-32" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-24 rounded-full" />
                <Skeleton className="h-8 w-20 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
