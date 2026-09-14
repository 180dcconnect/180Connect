import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

/**
 * F021 AC — shown while the dashboard's reads run.
 *
 * Rebuilt against `page.tsx` as it now stands, section for section and in the
 * same order: header, the F206 work strip, the unified Action Center, the
 * pipeline group (growth curve beside the queue dial, then the three stat tiles),
 * Performance, the admin row, and the two feeds.
 *
 * The previous version was a mirror of a dashboard that no longer exists — it
 * drew a client search field in the header (the header is the h1 and one button
 * now), a "Waiting on you" follow-up card and a "Needs attention" list (both
 * folded into the Action Center card), a Performance *bar* and a conversions
 * chart. Every one of those was a card that would not appear, and each pushed
 * everything below it down on swap.
 *
 * Geometry is taken from the components, not guessed:
 * `MyWorkStrip`'s `px-5 py-4` panel, the lg `ProgressMetricCard`'s
 * `min-h-[320px] sm:min-h-[460px]` with its `text-[88px]` headline,
 * `StatCard`'s `p-5` card with a gauge under the number, `ActionCenterCard`'s
 * `rounded-panel` with `px-5 py-3.5` rows, and `PerformanceSection`'s two
 * `rounded-[28px] border-border bg-card` cards — 28px, *not* the 16px the tiles
 * above them use, because those two keep `ProgressMetricCard`'s own radius while
 * the ones on this page pass `rounded-2xl`.
 *
 * Two things it deliberately does not try to predict, because they are data: the
 * length of the lists (the Action Center is drawn at its usual four rows, the
 * feeds at their five) and whether a section renders at all (the engine-health
 * panel and the admin row are conditional). Those move the page by a card at
 * most, and no static skeleton can be right about them.
 */
export default function Loading() {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-10">
        {/* Heading and "View all clients" */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <SkeletonLine
            text="text-[clamp(2rem,4vw,2.75rem)]"
            width="w-48 max-w-full"
          />
          <Skeleton className="h-11 w-40 shrink-0 rounded-full" />
        </div>

        {/* F206 — My work: four tiles, label + View pill, count + share */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="flex flex-col rounded-panel border border-rule bg-white px-5 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-5 w-28 max-w-full" />
                  <Skeleton className="h-6 w-14 shrink-0 rounded-full" />
                </div>
                <div className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-6">
                  <SkeletonLine
                    text="text-[clamp(1.75rem,4vw,2.5rem)]"
                    width="w-12"
                  />
                  <Skeleton className="h-5 w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Center — a heading, then the card of what needs doing */}
        <div className="space-y-4">
          <Skeleton className="h-[30px] w-40" />
          <div className="flex flex-col overflow-hidden rounded-panel border border-rule bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-5 pb-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-28" />
            </div>
            <ul className="divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 4 }).map((_, index) => (
                <li key={index} className="flex items-center gap-3 px-5 py-3.5">
                  <Skeleton className="h-8 w-[3px] shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-[18px] w-2/5 max-w-full" />
                    <Skeleton className="mt-1 h-[15px] w-28" />
                  </div>
                  <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
                  <Skeleton className="size-4 shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Pipeline: the growth curve beside the queue dial, then the counts */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
            <div className="relative z-20 flex flex-col xl:col-span-8">
              <div className="relative flex min-h-[320px] w-full flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm sm:min-h-[460px]">
                <div className="flex flex-1 flex-col px-5 pt-6 sm:px-10 sm:pt-9">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <Skeleton className="h-7 w-52 max-w-full sm:h-8" />
                    <Skeleton className="h-5 w-28 rounded-full" />
                  </div>
                  <Skeleton className="mt-5 h-12 w-56 max-w-full rounded-lg sm:h-[88px] sm:w-72" />
                </div>
              </div>
            </div>
            <div className="relative z-10 flex flex-col xl:col-span-4">
              <div className="relative flex h-full min-h-[320px] w-full flex-col justify-between overflow-hidden rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2.5 pb-4">
                  <Skeleton className="size-7 rounded-lg" />
                  <Skeleton className="h-6 w-36" />
                </div>
                <div className="mx-auto mt-4 aspect-square w-full max-w-[260px] rounded-full border-8 border-black/5" />
                <div className="mt-4 space-y-2 border-t border-black/[0.04] pt-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-7 w-full rounded-xl" />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* The suppression note, which only prints when something is suppressed */}
          <Skeleton className="h-5 w-80 max-w-full" />

          {/* Contacted / responses / converted */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"
              >
                <Skeleton className="h-[30px] w-32 max-w-full" />
                <div className="mt-8 flex items-end justify-between gap-3">
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-[58px] w-16 shrink-0 sm:h-[66px]" />
                </div>
                <div className="mt-4">
                  <Skeleton className="h-3.5 w-full rounded-sm" />
                  <Skeleton className="mt-2 h-[17px] w-32" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Performance: heading, scope controls, four tiles, two cards */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
            <Skeleton className="h-[30px] w-36" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-full" />
            <Skeleton className="h-9 w-40 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"
              >
                <Skeleton className="h-6 w-32 max-w-full" />
                <div className="mt-8 flex items-end justify-between gap-3">
                  <div className="flex flex-col">
                    <Skeleton className="h-9 w-16" />
                    <Skeleton className="mt-3 h-4 w-28" />
                  </div>
                  <Skeleton className="h-[58px] w-16 shrink-0 sm:h-[66px]" />
                </div>
              </div>
            ))}
          </div>
          {/* These two keep ProgressMetricCard's own radius — 28px, `border-border`
              and `bg-card` — because `PerformanceSection` passes no override. */}
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="relative flex min-h-[300px] w-full flex-col overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <div className="flex flex-1 flex-col px-5 pt-6 sm:px-8 sm:pt-7">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
                <Skeleton className="mt-5 h-10 w-40 rounded-lg" />
              </div>
              <div className="border-t border-foreground/[0.06] px-5 py-4 sm:px-8">
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
            <div className="flex min-h-[300px] flex-col rounded-[28px] border border-border bg-card p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <div className="flex items-baseline justify-between gap-3">
                <Skeleton className="h-6 w-44" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="mt-4 flex-1">
                <div className="grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem] gap-x-4 border-b border-black/[0.06] pb-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton
                      key={index}
                      className={`h-3 w-12 ${index > 0 ? "justify-self-end" : ""} ${index === 3 ? "hidden sm:block" : ""}`}
                    />
                  ))}
                </div>
                <ul className="divide-y divide-black/[0.04]">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <li
                      key={index}
                      className="grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem] items-center gap-x-4 py-2.5"
                    >
                      <Skeleton className="h-4 w-40 max-w-full" />
                      {Array.from({ length: 3 }).map((_, cellIndex) => (
                        <Skeleton
                          key={cellIndex}
                          className={`h-4 w-10 justify-self-end ${cellIndex === 2 ? "hidden sm:block" : ""}`}
                        />
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Admin row: the queues beside the AI spend they generate */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
                <Skeleton className="h-6 w-40" />
                <ul className="mt-4 divide-y divide-black/[0.06]">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <li
                      key={index}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <Skeleton className="h-4 w-40 max-w-full" />
                      <Skeleton className="h-6 w-12 shrink-0" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex min-h-[220px] flex-col rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-8 h-9 w-24" />
              <Skeleton className="mt-4 h-3.5 w-full rounded-sm" />
              <Skeleton className="mt-2 h-[17px] w-40" />
            </div>
          </div>
        </div>

        {/* Recent updates, then recent team activity — both paginated at five */}
        {["w-40", "w-56"].map((width, sectionIndex) => (
          <div key={sectionIndex} className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <Skeleton className={`h-[30px] ${width}`} />
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="flex flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
              <ul className="divide-y divide-black/[0.06]">
                {Array.from({ length: 5 }).map((_, index) => (
                  <li key={index} className="flex items-center gap-4 px-5 py-4">
                    <Skeleton className="size-9 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1">
                      <Skeleton className="h-4 w-2/3 max-w-full" />
                      <Skeleton className="mt-1.5 h-3 w-28" />
                    </div>
                    <Skeleton className="h-5 w-24 shrink-0 rounded-full" />
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-4 border-t border-black/[0.06] px-5 py-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-32 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
