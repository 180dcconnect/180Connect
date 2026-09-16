import { Skeleton, SkeletonSectionCard } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the AI group's heading (fixed copy, so drawn) over its tab
 * row, the description, then the "Labelled outcomes" gauge card and the
 * "By outcome" card. The tab row is bars for the reason given in
 * `ai-generations/loading.tsx`. Approximated because it is data.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Machine Learning
          </h1>
          <div className="mt-4 flex gap-1.5">
            <Skeleton className="h-8 w-44 rounded-full" />
            <Skeleton className="h-8 w-36 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-4 w-11/12 max-w-[68ch]" />
        </div>

        <div aria-hidden="true" className="space-y-6">
          <SkeletonSectionCard titleWidth="w-44" hintWidth="w-96" action>
            <Skeleton className="mt-4 h-10 w-40" />
            <Skeleton className="mt-3 h-10 w-full rounded-lg" />
            <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          </SkeletonSectionCard>
          <SkeletonSectionCard titleWidth="w-28" hintWidth="w-72">
            <div className="mt-4 divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex justify-between gap-4 py-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-8" />
                </div>
              ))}
            </div>
          </SkeletonSectionCard>
        </div>
      </div>
    </div>
  );
}
