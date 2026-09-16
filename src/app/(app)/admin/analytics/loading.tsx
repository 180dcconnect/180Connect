import { Skeleton, SkeletonStatCard } from "@/components/ui/skeleton";
import { AnalyticsHeader } from "../analytics-header";

/**
 * F212 — mirrors src/app/admin/analytics/page.tsx panel-for-panel, so the real
 * page lands underneath this without the layout shifting.
 *
 * This page runs six paged reads before it can render anything, which makes it
 * the slowest screen in the admin area — the one that most needs a skeleton
 * rather than a blank frame.
 *
 * The three shapes are the page's own: four `StatCard`s across the team, the lg
 * `ProgressMetricCard` (`min-h-[320px] sm:min-h-[460px]`, the same frame the
 * dashboards' curve uses), and the six-column `overflow-x-auto` table. The
 * chapter of the old version that drew the curve as a bare 460px `rounded-[28px]`
 * slab is gone with the `SkeletonCard` that carried it — the card's radius is
 * 16px now, and a slab that rounds at 28 while the card rounds at 16 shows bare
 * corners at both ends of the chart.
 *
 * Approximated because it is data: how many team members the table lists, and
 * whether the page shows its empty state or its load-failed alert instead.
 */
export default function AdminAnalyticsLoading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        {/* The real shared header — title and tab row paint immediately, so
            switching tabs leaves the header pixel-identical while the body
            below it skeleton-loads. Only the description is a bar. */}
        <header>
          <AnalyticsHeader current="/admin/analytics">
            <Skeleton className="mt-3 h-4 w-11/12 max-w-[68ch]" />
          </AnalyticsHeader>
        </header>

        {/* Across the team — four StatCards */}
        <section className="space-y-4">
          <Skeleton className="h-[30px] w-40" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SkeletonStatCard labelWidth="w-28" />
            <SkeletonStatCard labelWidth="w-24" />
            <SkeletonStatCard labelWidth="w-32" />
            <SkeletonStatCard labelWidth="w-24" />
          </div>
        </section>

        {/* Conversions over time — the lg chart card, then its dated caption */}
        <section className="space-y-4">
          <Skeleton className="h-[30px] w-52" />
          <div className="relative flex min-h-[320px] w-full flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm sm:min-h-[460px]">
            <div className="flex flex-1 flex-col px-5 pt-6 sm:px-10 sm:pt-9">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <Skeleton className="h-7 w-44 max-w-full sm:h-8" />
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
              <Skeleton className="mt-5 h-12 w-56 max-w-full rounded-lg sm:h-[88px] sm:w-72" />
            </div>
          </div>
          <Skeleton className="h-4 w-full max-w-[72ch]" />
        </section>

        {/* By team member — heading with its caption, then the six-column table */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Skeleton className="h-[30px] w-44" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/[0.06]">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <th key={index} className="px-5 py-3 text-left">
                      <Skeleton className="h-3.5 w-20" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {Array.from({ length: 6 }).map((_, rowIndex) => (
                  <tr key={rowIndex}>
                    {Array.from({ length: 6 }).map((_, index) => (
                      <td key={index} className="px-5 py-4">
                        <Skeleton
                          className={index === 0 ? "h-5 w-40" : "h-5 w-12"}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
