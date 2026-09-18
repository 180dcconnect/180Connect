import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the bone ground, the heading (fixed copy, so it is drawn
 * rather than guessed at), the lines that say what a decision does, the queue
 * rail, then the waiting requests and the decided history.
 *
 * No `max-w-*`: the page fills the column and its side padding sets where it
 * stops (docs/app-design-system.md §Width), and this frame matches that.
 *
 * Each waiting request is the `SectionCard` shape: title, "Requested by …"
 * hint, the paper reason block, the owner line, and the note field with the two
 * answers. Approximated because it is data: how many requests are waiting, and
 * whether any have been decided.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-ground px-6 py-10 sm:px-10 sm:py-12">
      <div className="w-full space-y-8">
        <div>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Ownership requests
          </h1>
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
          {/* The rail: one dot and one line. */}
          <Skeleton className="mt-4 h-4 w-72" />
        </div>

        <div aria-hidden="true" className="space-y-6">
          {/* The tab row, then two waiting requests — a card each. */}
          <div className="flex items-end gap-6 border-b border-rule pb-3">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-32" />
          </div>

          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="rounded-panel border border-rule bg-white px-5 py-4.5 sm:px-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div>
                  <Skeleton className="h-5 w-52" />
                  <Skeleton className="mt-1.5 h-4 w-64" />
                </div>
                <Skeleton className="h-6 w-44 rounded-full" />
              </div>
              <div className="mt-4 rounded-inset bg-paper px-3.5 py-3">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="mt-2 h-4 w-full max-w-xl" />
              </div>
              <Skeleton className="mt-2 h-4 w-80" />
              <div className="mt-4 border-t border-rule-soft pt-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-14 w-full rounded-inset" />
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Skeleton className="h-9 rounded-inset" />
                  <Skeleton className="h-9 rounded-inset" />
                </div>
              </div>
            </div>
          ))}

          {/* The history card: three quiet rows. */}
          <div className="overflow-hidden rounded-panel border border-rule bg-white">
            <ul className="divide-y divide-rule-soft">
              {Array.from({ length: 3 }).map((_, index) => (
                <li key={index} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div>
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="mt-1.5 h-3.5 w-72" />
                    </div>
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
