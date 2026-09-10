import { Skeleton } from "@/components/ui/skeleton";
import { DataImportsHeader } from "../data-imports-header";

/**
 * Mirrors page.tsx's shell: bone ground, the real Data imports header, then the
 * two white cards. The card heights approximate the real ones so the page does
 * not jump when it arrives.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <DataImportsHeader current="/admin/three-sixty-giving">
            <div className="mt-3 max-w-xl space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </DataImportsHeader>
        </div>

        <div className="space-y-6">
          <Skeleton className="h-64 w-full rounded-panel" />
          <Skeleton className="h-72 w-full rounded-panel" />
        </div>
      </div>
    </div>
  );
}
