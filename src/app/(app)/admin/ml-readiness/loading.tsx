import { Skeleton, SkeletonLine, SkeletonSectionCard } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the AI group's heading (fixed copy, so drawn) over its tab
 * row, the description, then the "Client outcomes in database" gauge card, the
 * outcomes breakdown card — whose dimension is the word after "Outcomes by", and
 * which keeps its page size on the heading row — and the three-step "How this
 * works" card.
 *
 * The tab row is bars for the reason given in `ai-generations/loading.tsx`.
 * The gauge card's big reading is drawn with `SkeletonLine` at the label's own
 * clamp, over a full-width track of stick-height bars — the shape the
 * `HorizontalStickGauge` prints — rather than one guessed slab.
 *
 * Approximated because it is data: how many outcomes are recorded and how they
 * break down by label.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="w-full space-y-8">
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
          <SkeletonSectionCard titleWidth="w-52" hintWidth="w-80" action>
            {/* The big "xx of 50" reading at its own type size, the stick gauge
                track, then the detail line. */}
            <SkeletonLine
              className="mt-4"
              text="text-[clamp(1.75rem,4vw,2.5rem)]"
              width="w-32"
            />
            <div className="mt-3 space-y-[5.5px]">
              {Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full rounded-sm" />
              ))}
            </div>
            <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          </SkeletonSectionCard>

          {/* The breakdown: the hint under the heading, the pager on the heading
              row beside the title, then a label and a count per row. Three rows is
              the drawn approximation — how many buckets there are is data. */}
          <SkeletonSectionCard
            action
            actionClassName="h-8 w-64"
            hintWidth="w-72"
            titleWidth="w-44"
          >
            <div className="mt-4 divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex justify-between gap-4 py-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-8" />
                </div>
              ))}
            </div>
          </SkeletonSectionCard>

          <SkeletonSectionCard titleWidth="w-36" hintWidth="w-80">
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-rule-soft bg-white p-4"
                >
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-6 shrink-0 rounded-full" />
                    <Skeleton className="h-5 w-28 max-w-full" />
                  </div>
                  <Skeleton className="mt-2 h-4 w-full" />
                  <Skeleton className="mt-1.5 h-4 w-3/4" />
                </div>
              ))}
            </div>
          </SkeletonSectionCard>
        </div>
      </div>
    </div>
  );
}
