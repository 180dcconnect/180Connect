import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the run-detail page, section for section: the back link, the heading
 * with its status pill and run id, the summary line, the five-count outcome
 * cards, and the record feed under its heading.
 *
 * Rewritten from the page. The old version drew a `h-10 rounded-full` bar where
 * the outcome stats go, at `grid-cols-4` — the page renders **five** count cards
 * in a `grid-cols-2 sm:grid-cols-5` (`rounded-2xl border-black/[0.06] bg-white
 * p-4 shadow-2xs`) — and one `SkeletonListPanel` for a record feed that is its own
 * shape entirely.
 *
 * The h1 is `text-3xl font-bold`, whose line box is 36px, not the 32px a `h-8`
 * bar suggests; the back link above it is a `text-xs uppercase` row.
 *
 * Approximated because it is data: whether the run failed (which adds the error
 * callout between the summary and the counts), how many records the feed lists,
 * and how long the summary sentence runs.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Back to Import Status */}
        <Skeleton className="h-4 w-44" />

        {/* Heading, the status pill beside it, the run id on the right */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-56 max-w-full" />
              <Skeleton className="h-7 w-24 shrink-0 rounded-full" />
            </div>
            <Skeleton className="h-4 w-28 shrink-0" />
          </div>
          <Skeleton className="h-5 w-full max-w-[80ch]" />
        </div>

        {/* Outcome stats — five cards, the page's own breakpoints */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-2xs"
            >
              <Skeleton className="h-4 w-20 max-w-full" />
              <Skeleton className="mt-1 h-8 w-16" />
            </div>
          ))}
        </dl>

        {/* The record feed, under its heading and count */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div className="min-w-0">
              <Skeleton className="h-6 w-64 max-w-full" />
              <Skeleton className="mt-1.5 h-4 w-80 max-w-full" />
            </div>
            <Skeleton className="h-4 w-28 shrink-0" />
          </div>
          <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
            {Array.from({ length: 6 }).map((_, index) => (
              <li key={index} className="flex items-start gap-4 px-5 py-4">
                <Skeleton className="mt-0.5 size-8 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-5 w-1/2 max-w-full" />
                  <Skeleton className="mt-1.5 h-4 w-2/3 max-w-full" />
                </div>
                <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
