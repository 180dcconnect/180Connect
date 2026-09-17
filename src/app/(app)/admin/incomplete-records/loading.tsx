import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the back link and heading (fixed copy, so drawn), the
 * "needs work" count line, then the panel's filter pills beside its search
 * field, and a page of the work cards.
 *
 * The card shape is `ClientCleaningCard`'s, which reads top-down as one job:
 * the client's name over what it is and where, a count pill and profile link
 * on the right; then the "start here" panel holding the first gap with its
 * editor open; then the rest of the gaps, named and closed; then the details
 * already on file. Drawn at two cards — the real page paginates at ten, and
 * two is enough to carry the rhythm without a skeleton taller than any
 * viewport.
 *
 * Approximated because it is data: how many records are incomplete, which gap
 * each one opens on, and how many details it already holds. The heading's
 * count line is drawn as the two figures it always names when the queue is
 * non-empty.
 */
export default function Loading() {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-10">
        <div>
          <Skeleton className="h-[15px] w-28" />
          <SkeletonLine
            className="mt-4"
            text="text-[clamp(2rem,4vw,2.75rem)]"
            width="w-72 max-w-full"
          />
          <Skeleton className="mt-1.5 h-4 w-full max-w-2xl" />
          <Skeleton className="mt-1.5 h-4 w-1/3" />
          {/* The "N of M active client records need work" line. */}
          <div className="mt-5 flex items-center gap-2">
            <Skeleton className="size-1.5 shrink-0 rounded-full" />
            <Skeleton className="h-5 w-64 max-w-full" />
          </div>
        </div>

        <div aria-hidden="true" className="space-y-6">
          {/* Filter pills beside the search field — bars, like the sibling
              loaders draw their tab rows. */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {["w-16", "w-20", "w-18", "w-20", "w-16", "w-22"].map((width, index) => (
                <Skeleton key={index} className={`h-8 rounded-full ${width}`} />
              ))}
            </div>
            <Skeleton className="h-10 w-full lg:w-72" />
          </div>

          {/* Two work cards */}
          {Array.from({ length: 2 }).map((_, cardIndex) => (
            <section
              key={cardIndex}
              aria-hidden="true"
              className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6"
            >
              {/* Who this is, and how much of it is missing. */}
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <Skeleton className="h-[26px] w-64 max-w-full" />
                  <Skeleton className="mt-1 h-4 w-72 max-w-full" />
                  <Skeleton className="mt-1 h-4 w-60 max-w-full" />
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                  <Skeleton className="h-6 w-40 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>

              {/* The gap to close first: heading and "Start here" on a
                  baseline, the one-line reason under it, then the editor —
                  a field beside its save button. */}
              <div className="mt-4 rounded-inset border border-rule bg-paper px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Skeleton className="h-5 w-48 max-w-full" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="mt-1 h-4 w-full max-w-lg" />
                <div className="mt-3 flex items-center gap-2">
                  <Skeleton className="h-10 flex-1 rounded-inset" />
                  <Skeleton className="h-8 w-28 rounded-inset" />
                </div>
              </div>

              {/* Also missing: each gap named, with what it costs, closed. */}
              <div className="mt-5">
                <Skeleton className="h-4 w-24" />
                <div className="mt-1">
                  {Array.from({ length: 2 }).map((_, rowIndex) => (
                    <div key={rowIndex} className="border-t border-rule-soft py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-6 w-28 rounded-inset" />
                      </div>
                      <Skeleton className="mt-1.5 h-4 w-full max-w-md" />
                    </div>
                  ))}
                </div>
              </div>

              {/* On file: label and "Change" on a baseline, the value under —
                  one line, or the paper box a saved mission prints in. */}
              <div className="mt-5">
                <Skeleton className="h-4 w-14" />
                <div className="mt-1">
                  {Array.from({ length: 2 }).map((_, rowIndex) => (
                    <div key={rowIndex} className="border-t border-rule-soft py-3.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-6 w-16 rounded-inset" />
                      </div>
                      <div className="mt-2.5">
                        {rowIndex === 0 ? (
                          <div className="rounded-inset bg-paper px-3.5 py-3">
                            <Skeleton className="h-4 w-full max-w-md" />
                          </div>
                        ) : (
                          <Skeleton className="h-4 w-56 max-w-full" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}

          {/* The pagination footer PaginatedList draws above ten records */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule-soft pt-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      </div>
    </div>
  );
}
