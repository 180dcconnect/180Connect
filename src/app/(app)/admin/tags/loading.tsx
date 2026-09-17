import { Skeleton, SkeletonLine, SkeletonSectionCard } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the ground and the shell, the display heading with its line
 * of copy and the rail of counts (all fixed, so drawn), then the create card and
 * the list card — the two `rounded-panel border-rule` sections the page renders,
 * not one white slab holding everything.
 *
 * Approximated because it is data: how many tags there are, how many are on a
 * client, whether this reader may create one at all (a viewer gets the note where
 * the form was), and whether the read failed.
 */
export default function Loading() {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <div>
          <SkeletonLine text="text-[clamp(2rem,4vw,2.75rem)]" width="w-32" />
          <Skeleton className="mt-3 h-5 w-3/4 max-w-full rounded-sm" />
          <Skeleton className="mt-2 h-5 w-1/2 max-w-full rounded-sm" />
          <Skeleton className="mt-3 h-5 w-56 max-w-full rounded-sm" />
        </div>

        {/* Create a tag */}
        <SkeletonSectionCard
          titleWidth="w-32"
          hintWidth="w-2/3"
          className="pb-4.5"
        >
          <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="min-w-[16rem] flex-1">
              <Skeleton className="h-4 w-56 max-w-full rounded-sm" />
              <Skeleton className="mt-1.5 h-10 w-full rounded-inset" />
            </div>
            <div>
              <Skeleton className="h-4 w-48 max-w-full rounded-sm" />
              <Skeleton className="mt-1.5 h-7 w-24 rounded-sm" />
            </div>
          </div>
          <div className="mt-4">
            <Skeleton className="h-4 w-24 rounded-sm" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-7 w-20 rounded-sm" />
              ))}
            </div>
          </div>
        </SkeletonSectionCard>

        {/* The team's tags */}
        <SkeletonSectionCard titleWidth="w-44" hintWidth="w-3/4" padded={false}>
          <ul className="mt-3 divide-y divide-rule-soft px-5 pb-4.5">
            {Array.from({ length: 4 }).map((_, index) => (
              <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <Skeleton className="h-7 w-24 rounded-sm" />
                <Skeleton className="h-4 w-32 rounded-sm" />
                <Skeleton className="ml-auto h-5 w-16 rounded-sm" />
              </li>
            ))}
          </ul>
        </SkeletonSectionCard>
      </div>
    </div>
  );
}
