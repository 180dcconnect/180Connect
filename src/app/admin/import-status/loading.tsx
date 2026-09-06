import { Skeleton, SkeletonListPanel } from "@/components/ui/skeleton";
import { DataImportsHeader } from "../data-imports-header";

/** Mirrors page.tsx's shell (bone ground, SearchRail column). */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="lg:pr-[472px]">
          <DataImportsHeader current="/admin/import-status">
            <div className="mt-3 max-w-xl space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          </DataImportsHeader>
        </div>
        <Skeleton className="h-[52px] w-full max-w-[440px] rounded-full lg:hidden" />

        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-3 w-40" />
          <SkeletonListPanel rows={6} />
        </div>
      </div>
    </div>
  );
}
