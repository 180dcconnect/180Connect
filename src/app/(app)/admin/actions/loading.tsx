import { Skeleton } from "@/components/ui/skeleton";
import { ActionsHeader } from "../../actions/actions-header";

export default function Loading() {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <ActionsHeader current="/admin/actions">
          <Skeleton className="mt-3 h-4 w-full max-w-3xl" />
        </ActionsHeader>

        <div aria-hidden="true" className="space-y-4">
          <div className="flex flex-wrap gap-2 rounded-panel border border-rule bg-white px-5 py-3">
            <Skeleton className="h-10 min-w-60 flex-1 rounded-inset" />
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-32 rounded-inset" />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-28 rounded-inset" />
          </div>

          <div className="overflow-hidden rounded-panel border border-rule bg-white">
            <div className="grid grid-cols-[2.2fr_1.35fr_1fr_8rem_7rem_7.5rem_2rem] gap-4 border-b border-rule bg-paper px-5 py-3">
              {Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full max-w-24" />
              ))}
            </div>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="grid grid-cols-[2.2fr_1.35fr_1fr_8rem_7rem_7.5rem_2rem] items-center gap-4 border-b border-rule-soft px-5 py-4 last:border-b-0">
                <div>
                  <Skeleton className="h-4 w-44 max-w-full" />
                  <Skeleton className="mt-2 h-3 w-56 max-w-full" />
                </div>
                <Skeleton className="h-4 w-36 max-w-full" />
                <Skeleton className="h-4 w-28 max-w-full" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="size-7 rounded-inset" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
