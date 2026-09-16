import { Skeleton, SkeletonSectionCard } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the AI group's heading (fixed copy, so drawn) over its tab
 * row, the description, the metric switch, the "over time" chart card, then the
 * "by model" and "History" section cards.
 *
 * The tab row is bars rather than the real `GroupTabs`: which tabs show depends
 * on the viewer's role, and reading that would make this file wait on the very
 * request it exists to cover. Approximated because it is data: how many models
 * and generations there are.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            AI generation history
          </h1>
          <div className="mt-4 flex gap-1.5">
            <Skeleton className="h-8 w-44 rounded-full" />
            <Skeleton className="h-8 w-36 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-4 w-11/12 max-w-[68ch]" />
          <Skeleton className="mt-2 h-4 w-2/3 max-w-[52ch]" />
        </div>

        <div aria-hidden="true" className="space-y-6">
          <div className="flex gap-1.5">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          <div className="rounded-panel border border-rule bg-white p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="mt-5 h-56 w-full rounded-lg" />
          </div>
          <SkeletonSectionCard titleWidth="w-48" hintWidth="w-96" action>
            <div className="mt-4 space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          </SkeletonSectionCard>
          <SkeletonSectionCard titleWidth="w-24" hintWidth="w-28">
            <div className="mt-4 divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex flex-wrap items-start justify-between gap-x-6 py-4">
                  <div className="min-w-0">
                    <Skeleton className="h-5 w-48 max-w-full" />
                    <Skeleton className="mt-1 h-5 w-64 max-w-full" />
                    <Skeleton className="mt-1.5 h-4 w-80 max-w-full" />
                  </div>
                  <Skeleton className="h-6 w-28 rounded-full" />
                </div>
              ))}
            </div>
          </SkeletonSectionCard>
        </div>
      </div>
    </div>
  );
}
