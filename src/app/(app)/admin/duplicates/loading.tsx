import { Skeleton, SkeletonSectionCard } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the bone ground, the heading (fixed copy, so it is drawn
 * rather than guessed at), the lines that say what a decision does, the queue
 * rail, then the flagged pairs and the decided history.
 *
 * No `max-w-*`: the page fills the column and its side padding sets where it
 * stops (docs/app-design-system.md §Width), and this frame matches that.
 *
 * Each pending pair is `PendingCard`'s shape: the `SectionCard` shell with its
 * title and "Matched on …" hint, the standing paragraph, the register-vs-client
 * comparison table, the explainer line under it, and the note field with the
 * two answers. The comparison table is drawn as its three columns (detail,
 * register copy, client copy) over four field rows.
 *
 * Approximated because it is data: how many pairs are waiting, what has already
 * been decided, and whether either read failed. The heading's two copies — the
 * admin's and leadership's — differ in their wording, so those are bars rather
 * than the real paragraph.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="w-full space-y-8">
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
          {/* Two pending pairs — a card each: the standing paragraph, the
              comparison table, the explainer, then the note field and the two
              answers. */}
          {Array.from({ length: 2 }).map((_, index) => (
            <SkeletonSectionCard key={index} titleWidth="w-56" hintWidth="w-72">
              <Skeleton className="mt-3.5 h-4 w-full max-w-2xl" />
              <Skeleton className="mt-1.5 h-4 w-1/2 max-w-md" />

              {/* ComparisonTable: detail | register | client, four field rows. */}
              <div className="mt-3.5 overflow-x-auto">
                <div className="grid min-w-[32rem] grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 border-b border-rule pb-1.5">
                  {Array.from({ length: 3 }).map((_, columnIndex) => (
                    <Skeleton
                      key={columnIndex}
                      className={`h-3 w-20 ${columnIndex === 0 ? "w-12" : ""}`}
                    />
                  ))}
                </div>
                {Array.from({ length: 4 }).map((_, rowIndex) => (
                  <div
                    key={rowIndex}
                    className="grid min-w-[32rem] grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-4 border-b border-rule-soft py-2 last:border-b-0"
                  >
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-full max-w-[85%]" />
                    <Skeleton className="h-4 w-full max-w-[85%]" />
                  </div>
                ))}
              </div>

              <div className="mt-4 border-t border-rule-soft pt-4">
                <Skeleton className="h-4 w-64" />
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
            <div className="mt-3 overflow-hidden rounded-panel border border-rule bg-white">
              <ul className="divide-y divide-rule-soft">
                {Array.from({ length: 3 }).map((_, index) => (
                  <li key={index} className="px-5 py-3.5">
                    <Skeleton className="h-4 w-48 max-w-full" />
                    <Skeleton className="mt-1 h-4 w-72 max-w-full" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
