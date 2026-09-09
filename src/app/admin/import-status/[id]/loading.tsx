import { Skeleton, SkeletonListPanel } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-9 w-72 max-w-full" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        </div>

        <div className="grid gap-3 sm:grid-cols-4 pt-4">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>

        <div className="space-y-4 pt-4">
          <Skeleton className="h-10 w-full rounded-full" />
          <SkeletonListPanel rows={6} />
        </div>
      </div>
    </div>
  );
}
