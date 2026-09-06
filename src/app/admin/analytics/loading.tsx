import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * F212 — mirrors the geometry of src/app/admin/analytics/page.tsx panel-for-panel,
 * so the real page lands underneath this without the layout shifting.
 *
 * This page runs six paged reads before it can render anything, which makes it
 * the slowest screen in the admin area — the one that most needs a skeleton
 * rather than a blank frame.
 */
export default function AdminAnalyticsLoading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-10 w-64" />
        </div>

        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={index}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-9 w-20" />
                <Skeleton className="mt-4 h-1 w-full" />
                <Skeleton className="mt-2 h-3 w-32" />
              </SkeletonCard>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-[320px] w-full rounded-[28px] sm:h-[460px]" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3 w-36" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
            <div className="border-b border-black/[0.06] px-5 py-3">
              <Skeleton className="h-3 w-full max-w-[36rem]" />
            </div>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="border-b border-black/[0.06] px-5 py-4 last:border-b-0">
                <Skeleton className="h-4 w-full max-w-[32rem]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
