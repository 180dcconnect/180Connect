import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

/**
 * F051 AC3 — shown while the charity list fetches.
 *
 * Mirror of `page.tsx`, which is not the page this file used to stand in for.
 * The list moved onto `SearchRail` (heading with a reserved right-hand gutter
 * for a sticky 440px bar) and gained the `PipelineReport` card above it, and the
 * skeleton was still drawing a bare h1, one grey 76px slab and six rows — so the
 * real page arrived with a search bar, a four-stage report and a 260px funnel
 * that had no placeholder at all, and everything below them jumped.
 *
 * Geometry is taken from the components rather than guessed:
 * `SearchRail`'s `pt-[76px] lg:pt-0 lg:pr-[472px]` heading reserve and
 * `lg:w-[440px]` bar, `PipelineReport`'s `rounded-3xl ring-1` card with its
 * `mt-6 grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-4` stage row and
 * `h-[190px] sm:h-[240px]` funnel, and the list's own
 * `lg:grid-cols-[2rem_minmax(0,1fr)_9rem_4.5rem_10rem_10rem_1rem]` row track,
 * held to the same widths so the columns do not shift under the real rows.
 *
 * Approximated because it is data: whether the heading says "Clients" or "My
 * clients", whether the CAM sees the Add-a-client button and the bulk-selection
 * column, and how many rows the page holds (drawn at the 25-row page size's
 * first screen — eight — since a skeleton taller than the fold is just a wall).
 */

/** The list's column track — copied from `page.tsx` so the two cannot drift. */
const ROW_GRID =
  "lg:grid lg:grid-cols-[2rem_minmax(0,1fr)_9rem_4.5rem_10rem_10rem_1rem] lg:items-center lg:gap-4";

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="relative mx-auto w-full max-w-6xl">
        {/* The sticky search rail. Reserved here, not drawn: a bar-shaped bar
            placeholder in a sticky column would sit still while the real one
            loads, which reads as a broken control rather than as a draft. */}
        <div className="pointer-events-none absolute inset-x-0 -top-1.5 bottom-0 z-40 lg:-top-2.5">
          <div className="sticky top-3 flex justify-end lg:top-3.5">
            {/* BrandSearchBar's collapsed row is 64px, and its radius is the same
                number — hence `rounded-full`, not a corner it will not have. */}
            <div className="w-full lg:w-[440px]">
              <Skeleton className="h-16 w-full rounded-full" />
            </div>
          </div>
        </div>

        <div>
          {/* Heading, the Add-a-client button, and the two-line lede */}
          <div className="mb-8 pt-[76px] lg:pt-0 lg:pr-[472px]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SkeletonLine
                text="text-[clamp(2rem,4vw,2.75rem)]"
                width="w-56 max-w-full"
              />
              <Skeleton className="h-11 w-32 shrink-0 rounded-full" />
            </div>
            <div className="mt-3 space-y-2">
              <Skeleton className="h-[22px] w-full max-w-[60ch]" />
              <Skeleton className="h-[22px] w-2/3 max-w-[60ch]" />
            </div>
          </div>

          <div className="space-y-4">
            {/* Pipeline report — four stage totals, the funnel, the breakdown */}
            <section className="overflow-hidden rounded-3xl bg-white ring-1 ring-black/[0.06] shadow-[0_20px_60px_-45px_rgba(12,16,20,0.55)]">
              <div className="px-6 py-6 sm:px-8">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-baseline gap-3">
                    <Skeleton className="h-[26px] w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-[26px] w-24 rounded-full" />
                </div>

                <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index}>
                      <Skeleton className="h-[18px] w-24 max-w-full" />
                      <SkeletonLine
                        className="mt-1.5"
                        text="text-[clamp(1.5rem,3.2vw,2.1rem)]"
                        width="w-20"
                      />
                      <Skeleton className="mt-1 h-[18px] w-28 max-w-full" />
                    </div>
                  ))}
                </div>
              </div>

              <Skeleton className="mt-1 h-[190px] w-full rounded-none sm:h-[240px]" />

              <div className="px-6 pt-2 pb-6 sm:px-8 sm:pb-8">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
                  <SkeletonLine
                    text="text-[26px]"
                    width="w-72 max-w-full"
                  />
                  <SkeletonLine text="text-[20px] sm:text-[22px]" width="w-20" />
                </div>
                <div className="mt-4 grid grid-cols-[minmax(0,1fr)_5rem] gap-4 border-b border-black/[0.07] px-2 pb-2 sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(3.5rem,6rem))]">
                  <span />
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton
                      key={index}
                      className={`h-3 w-12 justify-self-end ${index === 0 ? "" : "hidden sm:block"}`}
                    />
                  ))}
                </div>
                <ol>
                  {Array.from({ length: 3 }).map((_, rowIndex) => (
                    <li
                      key={rowIndex}
                      className="grid grid-cols-[minmax(0,1fr)_5rem] items-baseline gap-4 border-b border-black/[0.07] px-2 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(3.5rem,6rem))]"
                    >
                      <Skeleton className="h-[18px] w-40 max-w-full" />
                      {Array.from({ length: 4 }).map((_, index) => (
                        <Skeleton
                          key={index}
                          className={`h-[18px] w-10 justify-self-end ${index === 0 ? "" : "hidden sm:block"}`}
                        />
                      ))}
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            {/* Table toolbar — "Ordered for you" on the left, saved views right */}
            <div className="flex items-center justify-between gap-4 pt-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-32 rounded-full" />
            </div>

            {/* The list: column key, then rows on the same track */}
            <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
              <div className="hidden items-center gap-4 border-b border-black/[0.06] bg-black/[0.015] px-5 py-2.5 lg:flex">
                <span className="flex w-5 shrink-0 justify-center">
                  <Skeleton className="size-3.5 rounded" />
                </span>
                <span className={`${ROW_GRID} min-w-0 flex-1`}>
                  <span />
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-3 w-14" />
                  ))}
                </span>
                <span className="flex w-[6.5rem] shrink-0" />
              </div>

              <ul>
                {Array.from({ length: 8 }).map((_, index) => (
                  <li
                    key={index}
                    className="flex items-center gap-4 border-b border-black/[0.06] px-5 py-3.5 last:border-b-0"
                  >
                    <span className="flex w-5 shrink-0 justify-center">
                      <Skeleton className="size-3.5 rounded" />
                    </span>
                    <span className={`${ROW_GRID} min-w-0 flex-1`}>
                      <Skeleton className="hidden h-3.5 w-6 lg:block" />
                      <span className="min-w-0 flex-1 lg:flex-none">
                        <Skeleton className="h-[22px] w-2/3 max-w-full sm:w-56" />
                        {/* Below lg the subline carries type · location */}
                        <Skeleton className="mt-0.5 h-5 w-40 max-w-full lg:hidden" />
                        <Skeleton className="mt-1 hidden h-4 w-28 lg:block" />
                      </span>
                      <Skeleton className="hidden h-4 w-24 lg:block" />
                      <Skeleton className="hidden h-3 w-20 lg:block" />
                      <Skeleton className="hidden h-6 w-28 rounded-full lg:block" />
                      <Skeleton className="hidden h-3 w-24 lg:block" />
                      <span />
                    </span>
                    <span className="flex w-[6.5rem] shrink-0 justify-end">
                      <Skeleton className="h-7 w-16 rounded-full" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Count and pagination */}
            <div className="flex flex-col items-center justify-between gap-4 pt-4 sm:flex-row">
              <Skeleton className="h-3 w-32" />
              <div className="flex items-center gap-4">
                <Skeleton className="h-3 w-24" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-7 w-24 rounded-full" />
                  <Skeleton className="h-7 w-20 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
