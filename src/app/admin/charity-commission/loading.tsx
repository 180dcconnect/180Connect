import { Skeleton, SkeletonListPanel } from "@/components/ui/skeleton";
import { DataImportsHeader } from "../data-imports-header";

/**
 * Mirrors page.tsx's shell: bone ground, the real Data imports header, then the
 * stack of white cards. The card heights approximate the real ones so the page
 * does not jump when it arrives.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <DataImportsHeader current="/admin/charity-commission">
            <Skeleton className="mt-4 h-5 w-80 max-w-full" />
          </DataImportsHeader>
        </div>

        <div className="space-y-6">
          <SkeletonListPanel rows={5} />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
