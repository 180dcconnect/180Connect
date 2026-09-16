import { Skeleton, SkeletonListPanel, SkeletonSectionCard } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the bone ground, the heading (fixed copy, so it is drawn
 * rather than guessed at), the lines that say what a decision does, the queue
 * rail, then the flagged pairs and the decided history.
 *
 * Approximated because it is data: how many pairs are waiting, what has already
 * been decided, and whether either read failed. The heading's two copies — the
 * admin's and leadership's — differ in their wording, so those are bars rather
 * than the real paragraph.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Possible duplicate charities
          </h1>
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-11/12" />
          <Skeleton className="mt-2 h-4 w-2/3" />
          {/* The rail: one dot and one line. */}
          <Skeleton className="mt-4 h-4 w-72" />
        </div>

        <div aria-hidden="true" className="space-y-6">
          {/* Two pending pairs — a card each, ending in the note field and the
              two answers. */}
          {Array.from({ length: 2 }).map((_, index) => (
            <SkeletonSectionCard key={index} titleWidth="w-56" hintWidth="w-72">
              <Skeleton className="mt-3.5 h-12 w-full rounded-inset" />
              <div className="mt-4 border-t border-rule-soft pt-4">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="mt-1.5 h-16 w-full rounded-inset" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Skeleton className="h-7 w-60 rounded-inset" />
                  <Skeleton className="h-7 w-72 rounded-inset" />
                </div>
              </div>
            </SkeletonSectionCard>
          ))}

          <div>
            <Skeleton className="ml-1 h-[23px] w-40" />
            <SkeletonListPanel panel rows={3} className="mt-3" rowClassName="py-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}
