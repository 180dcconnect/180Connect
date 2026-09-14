import { Skeleton, SkeletonLine, SkeletonTable } from "@/components/ui/skeleton";

/**
 * F180 — loading frame for `/admin/dashboard`.
 *
 * Rebuilt as a mirror of the page rather than the six grey slabs it used to be.
 * The old version drew whole cards as single `Skeleton` rectangles, which is the
 * one thing a loading state must not do: a `bg-black/10` block the size of a card
 * is a dark rectangle where the page will draw a *white* one, so the swap flashes
 * no matter how well the outer geometry lines up. Every card here is now the real
 * card — same border, radius, padding and row rhythm — with bars where the words
 * go.
 *
 * Order matches `page.tsx`: heading, then the machine (duty queue + import
 * health), then the pipeline (growth curve, the three tiles, stage pills,
 * ownership, bands, sectors). Same ground, same `max-w-6xl`, same `space-y-10`.
 *
 * What is data and therefore approximated: how many rows each queue has (drawn
 * at the five queues and six sources the cards actually cap at), the stage-pill
 * count, and the ownership rows.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        {/* Heading, lede and the review-queue pill with its count */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <SkeletonLine text="text-[clamp(2rem,4vw,2.75rem)]" width="w-72 max-w-full" />
            <div className="mt-3 max-w-xl">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          </div>
          <Skeleton className="h-10 w-44 shrink-0 rounded-full" />
        </div>

        {/* The machine: duty queue beside import health */}
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <section className="rounded-panel border border-rule bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <ul className="divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 5 }).map((_, index) => (
                <li
                  key={index}
                  className="flex items-center justify-between gap-4 px-5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-40 max-w-full" />
                    <Skeleton className="mt-0.5 h-[18px] w-56 max-w-full" />
                  </div>
                  <Skeleton className="h-[18px] w-8 shrink-0" />
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-panel border border-rule bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex items-center gap-2.5 border-t border-rule-soft px-5 py-3">
              <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            <ul className="divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 6 }).map((_, index) => (
                <li key={index} className="flex items-start gap-2.5 px-5 py-2.5">
                  <Skeleton className="mt-[7px] size-1.5 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-44 max-w-full" />
                    <Skeleton className="mt-0.5 h-[18px] w-64 max-w-full" />
                  </div>
                  <Skeleton className="h-4 w-16 shrink-0 self-center" />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          {/* 30-day cumulative growth curve, footerless at the lg size */}
          <div className="relative flex min-h-[320px] w-full flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm sm:min-h-[460px]">
            <div className="flex flex-1 flex-col px-5 pt-6 sm:px-10 sm:pt-9">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <Skeleton className="h-7 w-56 max-w-full sm:h-8" />
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
              <Skeleton className="mt-5 h-12 w-56 max-w-full rounded-lg sm:h-[88px] sm:w-72" />
            </div>
          </div>

          {/* Contacted / responses / converted */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"
              >
                <Skeleton className="h-6 w-32" />
                <div className="mt-8 flex items-end justify-between gap-3">
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-[58px] w-16 sm:h-[66px]" />
                </div>
                <div className="mt-4">
                  <Skeleton className="h-5 w-full rounded-sm" />
                  <Skeleton className="mt-2 h-3 w-28" />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>

        {/* Pipeline stages — a pill per status, count inside */}
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-32 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>

        {/* Ownership load and priority bands */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
              <ul className="divide-y divide-black/5">
                {Array.from({ length: 6 }).map((_, index) => (
                  <li
                    key={index}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-5 w-10" />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-1 h-4 w-72 max-w-full" />
            </div>
            <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton className="h-4 w-24 shrink-0" />
                    <Skeleton className="h-2 flex-1 rounded-full" />
                    <Skeleton className="h-4 w-12 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Sectors: concentration and mean score */}
        <div className="space-y-3">
          <div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-1 h-4 w-64 max-w-full" />
          </div>
          <SkeletonTable rows={6} columns={3} />
        </div>
      </div>
    </div>
  );
}
