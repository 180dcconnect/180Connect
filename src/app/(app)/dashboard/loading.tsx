import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

/**
 * F021 AC — shown while the dashboard's reads run.
 *
 * Rebuilt against `page.tsx` as it now stands, section for section and in the
 * same order: header, the F206 work strip, the admin duty queue beside Sending
 * capacity, the pipeline group (growth curve beside the queue dial, then the
 * three stat tiles), Performance, Priority Opportunities, the AI spend preview
 * beside Your tasks, and the Recent updates feed.
 *
 * The previous version was a mirror of a dashboard one redesign behind: it
 * drew the old `AiSpendCard` (window control, spend headline, daily chart) and
 * a four-row list in its place, where the page now renders
 * `AiSpendOverviewPreview` — headline, window pills, the "What it went on"
 * split, the stick chart and the usage footer — beside `MyActionsCard`'s two
 * lists. It also predated Priority Opportunities entirely.
 *
 * Geometry is taken from the components, not guessed:
 * `MyWorkStrip`'s borderless `rounded-panel bg-white px-5 py-4` tiles with a
 * filled "View" pill beside the label, `AdminActionCenter`'s `p-6` header and
 * hairline grid of six tiles, `ProgressMetricCard` lg's
 * `min-h-[320px] sm:min-h-[460px]` with its `text-[88px]` headline,
 * `StatCard`'s `p-5` card, `PerformanceSection`'s two `rounded-[28px]
 * border-border bg-card` cards, `PriorityOpportunitiesCard`'s grid of
 * `rounded-panel` tiles with a dial and a full-width View, and
 * `AiSpendOverviewPreview`'s headline/plot/footer rows.
 *
 * Two things it deliberately does not try to predict, because they are data: the
 * length of the lists (Your tasks is drawn at its five task rows, the feed
 * at its five) and whether a section renders at all (the engine-health panel,
 * the onboarding guide and the health cards are conditional).
 * Those move the page by a card at most, and no static skeleton can be right
 * about them.
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

        {/* F206 — My work: four borderless tiles, label + View pill, count + book */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col rounded-panel bg-white px-5 py-4">
              <p className="flex items-center justify-between gap-3">
                <Skeleton className="h-5 w-28 max-w-full" />
                <Skeleton className="h-[26px] w-14 shrink-0 rounded-lg" />
              </p>
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

        {/* Admin duty queue beside today's branch-wide sending limit */}
        <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-3">
          {/* AdminActionCenter: p-6 header row, then the hairline grid of six
              queue tiles (label + count pill on one line, caption below). */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm xl:col-span-2">
            <div className="flex items-baseline justify-between border-b border-black/[0.06] p-6">
              <Skeleton className="h-7 w-44" />
              <Skeleton className="h-3.5 w-32" />
            </div>
            <div className="grid grow grid-cols-1 gap-px bg-black/[0.06] sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="flex flex-col bg-white p-6">
                  <div className="mb-2 flex items-center justify-between">
                    <Skeleton className="h-5 w-40 max-w-full" />
                    <Skeleton className="h-6 w-8 shrink-0 rounded-full" />
                  </div>
                  <Skeleton className="mt-auto h-4 w-full max-w-[80%]" />
                </div>
              ))}
            </div>
          </div>
          {/* SendingCapacityCard: title, sub-line, the remaining reading, the
              stick gauge and its caption. */}
          <div className="flex flex-col rounded-panel border border-rule bg-white px-5 py-4">
            <Skeleton className="h-[23px] w-44 max-w-full" />
            <Skeleton className="mt-1 h-5 w-full" />
            <SkeletonLine
              className="mt-8"
              text="text-[clamp(1.75rem,4vw,2.5rem)]"
              width="w-24"
            />
            <div className="mt-4 space-y-[5.5px]">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full rounded-sm" />
              ))}
            </div>
            <Skeleton className="mt-2 h-4 w-44" />
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
          {/* These two keep the chart cards' own radius — 28px, `border-border`
              and `bg-card` — because `PerformanceSection` passes no override. */}
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {/* The funnel chart: title and subtitle, three legend figures, plot. */}
            <div className="flex min-h-[380px] w-full flex-col rounded-[28px] border border-border bg-card p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="space-y-1.5">
                  <Skeleton className="h-6 w-56" />
                  <Skeleton className="h-3.5 w-44" />
                </div>
                <Skeleton className="h-6 w-28 rounded-full" />
              </div>
              <div className="mt-4 flex gap-6">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="space-y-1.5">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-6 w-16" />
                  </div>
                ))}
              </div>
              <Skeleton className="mt-6 w-full flex-1 rounded-lg" />
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

        {/* Priority Opportunities: heading row over a grid of ranked tiles */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <div>
              <Skeleton className="h-5 w-52" />
              <Skeleton className="mt-1 h-4 w-64 max-w-full" />
            </div>
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="flex h-full flex-col rounded-panel border border-rule bg-white p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <Skeleton className="mt-1 h-5 w-9 rounded-md" />
                  {/* PriorityMiniDial: a w-[78px] instrument over its reading. */}
                  <div className="flex flex-col items-center">
                    <Skeleton className="h-8 w-[78px] rounded-md" />
                    <Skeleton className="mt-0.5 h-5 w-10" />
                    <Skeleton className="mt-1 h-3 w-12" />
                  </div>
                </div>
                <Skeleton className="mt-3 h-5 w-3/4 max-w-full" />
                <Skeleton className="mt-1 h-4 w-1/2 max-w-full" />
                <Skeleton className="mt-2 h-4 w-full max-w-[90%]" />
                <div className="mt-3.5 space-y-1.5">
                  {Array.from({ length: 3 }).map((_, lineIndex) => (
                    <div key={lineIndex} className="flex items-center gap-2">
                      <Skeleton className="h-4 flex-1 max-w-[70%]" />
                      <Skeleton className="h-1 w-9 shrink-0 rounded-full" />
                      <Skeleton className="h-4 w-7 shrink-0" />
                    </div>
                  ))}
                </div>
                <div className="mt-auto pt-4">
                  <Skeleton className="h-8 w-full rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI spend preview beside Your tasks */}
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
          {/* AiSpendOverviewPreview: header row, spend headline beside the
              window pills, the "What it went on" split, the stick plot, and the
              usage footer. */}
          <div className="flex flex-col overflow-hidden rounded-panel border border-rule bg-white xl:col-span-2">
            <div className="flex items-center justify-between gap-4 border-b border-rule-soft px-5 py-3.5 sm:px-6">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-[30px] w-40 rounded-inset" />
            </div>
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-5 pt-4 sm:px-6">
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Skeleton className="h-[30px] w-24" />
                  <Skeleton className="h-5 w-40 max-w-full" />
                </div>
                <Skeleton className="mt-1.5 h-4 w-48 max-w-full" />
              </div>
              <Skeleton className="h-[34px] w-64 rounded-[10px]" />
            </div>
            <div className="px-5 pt-8 pb-6 sm:px-6 sm:pb-8">
              <Skeleton className="h-[21px] w-32" />
              <div className="mt-2.5 space-y-[5.5px]">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-4 w-full rounded-sm" />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <Skeleton className="size-1.5 shrink-0 rounded-full" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            </div>
            <Skeleton className="mx-2 mt-2 h-[252px] rounded-lg sm:mx-4" />
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pt-4 pb-5 sm:px-6">
              <Skeleton className="h-4 w-56 max-w-full" />
              <Skeleton className="h-4 w-full max-w-md" />
            </div>
          </div>

          {/* MyActionsCard: heading row, five action rows, the drafts
              sub-heading, then three draft rows. */}
          <div className="flex flex-col overflow-hidden rounded-panel border border-rule bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3">
              <div>
                <Skeleton className="h-[23px] w-28" />
                <Skeleton className="mt-1 h-4 w-44 max-w-full" />
              </div>
              <Skeleton className="h-4 w-32" />
            </div>
            <ul className="divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 5 }).map((_, index) => (
                <li key={index} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-[18px] w-2/5 max-w-full" />
                    <Skeleton className="mt-0.5 h-4 w-28 max-w-full" />
                  </div>
                  <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
                </li>
              ))}
            </ul>
            <div className="border-t border-rule px-5 pt-3 pb-2">
              <Skeleton className="h-[19px] w-32" />
            </div>
            <ul className="divide-y divide-rule-soft">
              {Array.from({ length: 3 }).map((_, index) => (
                <li key={index} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-[18px] w-1/3 max-w-full" />
                    <Skeleton className="mt-0.5 h-4 w-2/5 max-w-full" />
                  </div>
                  <Skeleton className="h-6 w-14 shrink-0 rounded-full" />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Recent updates — one feed, paginated at five */}
        <div className="space-y-4">
          <Skeleton className="h-[30px] w-40" />
          <div className="flex flex-col overflow-hidden rounded-panel border border-rule bg-white">
            <ul className="divide-y divide-rule-soft">
              {Array.from({ length: 5 }).map((_, index) => (
                <li key={index} className="flex h-[84px] items-center gap-4 px-5 py-3">
                  <Skeleton className="h-3 w-6 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-2/3 max-w-full" />
                    <Skeleton className="mt-1.5 h-3 w-28" />
                  </div>
                  <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-4 border-t border-rule-soft px-5 py-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-32 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
