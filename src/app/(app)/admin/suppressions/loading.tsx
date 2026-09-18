import { Skeleton, SkeletonLine, SkeletonSectionCard } from "@/components/ui/skeleton";

/**
 * Filed Record loading frame matching the block card, the request queue, the
 * active suppressions and the history below.
 *
 * The block form is closed until an admin asks for it, so the card is drawn as
 * it loads: the pill and the button that opens it on the heading row, and an
 * empty body. Nothing is drawn where the form will be — it starts at zero height
 * and grows, so a placeholder in its place would be the shape jumping.
 *
 * All three lists page from the top — the request queue in one row above its
 * first card, the other two with the page size on the heading row and the count
 * under it — so no frame carries a footer.
 */
export default function Loading() {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-8">
        <div>
          <SkeletonLine text="text-[clamp(2rem,4vw,2.75rem)]" width="w-72" />
          <Skeleton className="mt-4 h-5 w-full" />
          <Skeleton className="mt-1.5 h-5 w-4/5" />
        </div>

        <Skeleton className="h-5 w-80 max-w-full" />

        <SkeletonSectionCard
          titleWidth="w-44"
          hintWidth="w-4/5"
          action
          actionClassName="h-8 w-64"
        />

        <div className="space-y-4">
          <div>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="mt-2 h-5 w-3/5" />
          </div>
          {/* The request queue has no card heading of its own, so its count and
              its page size share the row above the first request. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-8 w-36 rounded-full" />
          </div>
          <SkeletonSectionCard titleWidth="w-52" hintWidth="w-72" action>
            <Skeleton className="mt-4 h-16 w-full" />
            <Skeleton className="mt-4 h-20 w-full" />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </SkeletonSectionCard>
        </div>

        {Array.from({ length: 2 }).map((_, index) => (
          <SkeletonSectionCard
            key={index}
            titleWidth={index === 0 ? "w-44" : "w-40"}
            hintWidth="w-3/5"
            action
            actionClassName="h-8 w-56"
          >
            {/* Both of these paginate from the top: the count and the chevrons
                are the first line of the body, the page size is on the heading
                row above, beside the pill. */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="mt-3 space-y-3 border-t border-rule-soft pt-4">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-4 w-72" />
            </div>
          </SkeletonSectionCard>
        ))}
      </div>
    </div>
  );
}
