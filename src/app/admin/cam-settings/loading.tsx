import { Skeleton, SkeletonListPanel } from "@/components/ui/skeleton";

/** Mirrors page.tsx's shell (bone ground, 5xl column) while the CAM settings load. */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div className="min-w-0">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <SkeletonListPanel rows={4} />
      </div>
    </div>
  );
}
