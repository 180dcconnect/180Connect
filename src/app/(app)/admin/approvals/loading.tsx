import { Skeleton, SkeletonLine, SkeletonPanel } from "@/components/ui/skeleton";

/** F181 — Loading skeleton for Approvals Tab. */
export default function Loading() {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-8">
        <header className="space-y-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <SkeletonLine
                text="text-[clamp(2rem,4vw,2.75rem)]"
                width="w-44"
              />
              <Skeleton className="mt-3 h-[23px] w-[34rem] max-w-full" />
            </div>
            <Skeleton className="h-7 w-28 rounded-inset" />
          </div>
        </header>

        <div className="flex gap-6 border-b border-rule pb-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-32" />
        </div>

        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonPanel key={index} className="px-5 py-5 sm:px-6" padded={false}>
              <div className="flex items-start justify-between gap-4 border-b border-rule-soft pb-4">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-6 w-56 max-w-full" />
                  <Skeleton className="mt-2 h-4 w-72 max-w-full" />
                </div>
                <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
              </div>
              <Skeleton className="mt-4 h-5 w-40" />
              <div className="mt-3 grid overflow-hidden rounded-inset border border-rule-soft bg-paper sm:grid-cols-2">
                <div className="p-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-2 h-5 w-48 max-w-full" />
                </div>
                <div className="border-t border-rule-soft bg-lead-wash/55 p-4 sm:border-t-0 sm:border-l">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-2 h-5 w-48 max-w-full" />
                </div>
              </div>
              <div className="mt-4 border-t border-rule-soft pt-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-16 w-full rounded-inset" />
                <div className="mt-3 flex gap-2.5">
                  <Skeleton className="h-9 w-36 rounded-inset" />
                  <Skeleton className="h-9 w-20 rounded-inset" />
                </div>
              </div>
            </SkeletonPanel>
          ))}
        </div>
      </div>
    </div>
  );
}
