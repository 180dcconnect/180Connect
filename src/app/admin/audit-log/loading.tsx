import { Skeleton, SkeletonListPanel } from "@/components/ui/skeleton";

/** F234 — mirrors page.tsx's shell (bone ground, SearchRail column). */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-6 lg:pr-[472px]">
        <div>
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-[52px] w-full max-w-[440px] rounded-full lg:hidden" />

        <div className="space-y-4 pt-4">
          <Skeleton className="h-3 w-32" />
          <SkeletonListPanel rows={6} />
        </div>
      </div>
    </div>
  );
}
