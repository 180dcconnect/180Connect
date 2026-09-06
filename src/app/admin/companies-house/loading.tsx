import { Skeleton, SkeletonCard, SkeletonListPanel } from "@/components/ui/skeleton";
import { DataImportsHeader } from "../data-imports-header";

/**
 * Mirrors page.tsx's shell: bone ground, the shared Data imports header —
 * rendered for real, since mark, title and tab row are all static — then
 * skeletons for the register rail and the run history that need a round trip.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <DataImportsHeader current="/admin/companies-house">
            <Skeleton className="mt-4 h-5 w-80 max-w-full" />
          </DataImportsHeader>
        </div>

        <div className="space-y-6">
          <SkeletonCard>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-3 h-4 w-64 max-w-full" />
          </SkeletonCard>
          <SkeletonListPanel rows={5} />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
