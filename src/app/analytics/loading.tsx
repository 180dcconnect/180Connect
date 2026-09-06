import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * Mirrors the geometry of src/app/analytics/page.tsx card-for-card, so the real
 * page lands underneath this without the layout shifting.
 */
export default function AnalyticsLoading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-10 w-64" />
        </div>

        <div className="space-y-4">
          <Skeleton className="h-6 w-36" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
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
          <Skeleton className="h-6 w-56" />
          <SkeletonCard>
            <Skeleton className="h-3 w-48" />
            <Skeleton className="mt-3 h-9 w-28" />
            <div className="mt-5 flex gap-8">
              <Skeleton className="h-10 w-20" />
              <Skeleton className="h-10 w-20" />
            </div>
            <Skeleton className="mt-4 h-3 w-64" />
          </SkeletonCard>
        </div>

        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <SkeletonCard>
            <Skeleton className="h-3 w-56" />
            <Skeleton className="mt-3 h-9 w-32" />
            <div className="mt-5 flex gap-8">
              <Skeleton className="h-10 w-20" />
              <Skeleton className="h-10 w-20" />
              <Skeleton className="h-10 w-20" />
            </div>
            <Skeleton className="mt-4 h-3 w-72" />
          </SkeletonCard>
        </div>
      </div>
    </div>
  );
}
