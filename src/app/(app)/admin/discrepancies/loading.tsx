import { Skeleton, SkeletonLine, SkeletonSectionCard } from "@/components/ui/skeleton";

/** Filed Record loading frame matching the queue, comparison cards and history. */
export default function Loading() {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-8">
        <div>
          <SkeletonLine text="text-[clamp(2rem,4vw,2.75rem)]" width="w-80" />
          <Skeleton className="mt-4 h-5 w-full" />
          <Skeleton className="mt-1.5 h-5 w-4/5" />
        </div>

        <Skeleton className="h-5 w-72 max-w-full" />

        <div className="space-y-4">
          <div>
            <Skeleton className="h-6 w-44" />
            <Skeleton className="mt-2 h-5 w-3/5" />
          </div>
          {Array.from({ length: 2 }).map((_, index) => (
            <SkeletonSectionCard
              key={index}
              titleWidth="w-36"
              hintWidth="w-72"
              action
            >
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {Array.from({ length: 2 }).map((__, valueIndex) => (
                  <div key={valueIndex} className="min-h-32 rounded-inset bg-paper px-4 py-3.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="mt-3 h-5 w-3/4" />
                    <Skeleton className="mt-8 h-3 w-28" />
                  </div>
                ))}
              </div>
              <Skeleton className="mt-4 h-20 w-full" />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </SkeletonSectionCard>
          ))}
        </div>

        <SkeletonSectionCard
          titleWidth="w-40"
          hintWidth="w-3/5"
          action
          actionClassName="h-8 w-56"
        >
          {/* The history paginates, from the top: the count and the chevrons are
              the first line of the body, the page size is on the heading row
              above, beside the number of decisions. */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="mt-3 space-y-4 border-t border-rule-soft pt-4">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-72" />
          </div>
        </SkeletonSectionCard>
      </div>
    </div>
  );
}
