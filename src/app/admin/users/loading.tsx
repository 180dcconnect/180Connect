import { Skeleton, SkeletonListPanel } from "@/components/ui/skeleton";

/** F234 — mirrors page.tsx's shell (bone ground, header + two list sections). */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>

        <div className="space-y-4">
          <Skeleton className="h-4 w-40" />
          <SkeletonListPanel rows={5} />
        </div>

        <div className="space-y-4">
          <Skeleton className="h-4 w-40" />
          <SkeletonListPanel rows={2} />
        </div>
      </div>
    </div>
  );
}
