import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Mirrors page.tsx's shell (bone ground, narrow 2xl column) while drafts load. */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-11 w-72 max-w-full" />
        </div>
        <SkeletonCard>
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-10 w-full" />
          <Skeleton className="mt-4 h-4 w-28" />
          <Skeleton className="mt-3 h-10 w-full" />
          <Skeleton className="mt-6 h-10 w-32 rounded-full" />
        </SkeletonCard>
      </div>
    </div>
  );
}
