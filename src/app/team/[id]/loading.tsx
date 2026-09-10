import { Skeleton, SkeletonCard, SkeletonListPanel } from "@/components/ui/skeleton";

/**
 * Shown while a team member's profile fetches. Mirrors page.tsx's shell (bone
 * ground, 1400px column) so the swap-in doesn't jump.
 *
 * This route runs seven queries in one `Promise.all` plus a conditional inviter
 * lookup, and had no loading state at all — a slow render left the previous
 * screen sitting there with nothing to say a navigation had happened.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <Skeleton className="h-9 w-72 max-w-full" />
            <Skeleton className="mt-3 h-4 w-56 max-w-full" />
          </div>
          <Skeleton className="h-10 w-28 rounded-full" />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <SkeletonCard>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-4 h-3 w-40 max-w-full" />
          </SkeletonCard>
          <SkeletonCard>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-4 h-3 w-40 max-w-full" />
          </SkeletonCard>
          <SkeletonCard>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-4 h-3 w-40 max-w-full" />
          </SkeletonCard>
        </div>

        <div className="space-y-4">
          <Skeleton className="h-4 w-40" />
          <SkeletonListPanel rows={5} />
        </div>
      </div>
    </div>
  );
}
