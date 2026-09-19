import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the run-detail page, section for section: the back link, the display
 * heading with its rail of facts, the outcome card with its stat tiles and
 * gauge, and the records card with a pager line above its rows.
 *
 * The search bar is not drawn. It rides the page's own rail, which is sticky
 * and lands on top of whatever is under it — a grey bar standing in for it
 * would simply be replaced a moment later in a different place.
 *
 * Approximated because it is data: whether the run failed (which adds the error
 * card above the counts), how many counts a source reports, and how many
 * records the run holds.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        {/* Back to Import status */}
        <div>
          <Skeleton className="h-4 w-28" />

          {/* The display heading, the rail of facts, the summary line */}
          <Skeleton className="mt-3 h-10 w-80 max-w-full" />
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="mt-3 h-4 w-full max-w-[70ch]" />
        </div>

        {/* What this run did */}
        <div className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="rounded-inset bg-paper px-4 py-3">
                <Skeleton className="h-3.5 w-20 max-w-full" />
                <Skeleton className="mt-2 h-6 w-14" />
              </div>
            ))}
          </dl>
          <Skeleton className="mt-5 h-4 w-64 max-w-full" />
          <Skeleton className="mt-3 h-3 w-full" />
        </div>

        {/* Records in this run */}
        <div className="rounded-panel border border-rule bg-white px-5 py-4.5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-2 h-4 w-96 max-w-full" />
            </div>
            <Skeleton className="h-7 w-32 shrink-0 rounded-full" />
          </div>
          <Skeleton className="mt-3.5 h-4 w-40" />
          <ul className="mt-1">
            {Array.from({ length: 6 }).map((_, index) => (
              <li
                key={index}
                className="flex items-start gap-3 border-t border-rule-soft py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="h-6 w-28 shrink-0 rounded-full" />
                    <Skeleton className="h-4 w-1/2 max-w-full" />
                  </div>
                  <Skeleton className="mt-2 h-3.5 w-2/3 max-w-full" />
                </div>
                <Skeleton className="h-4 w-20 shrink-0" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
