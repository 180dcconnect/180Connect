import { Skeleton } from "@/components/ui/skeleton";

/**
 * F234 — mirrors page.tsx's shell: bone ground, a `SearchRail` column, then the
 * team table and the pending-invites section.
 *
 * Rebuilt because the old version reserved `lg:pr-[472px]` on the whole column.
 * `SearchRail` reserves the bar's width on the **heading** only — the bar rides an
 * absolutely positioned rail, and everything below is full width — so the reserve
 * was narrowing the table by 472px against the real page and the columns moved
 * sideways on swap.
 *
 * The two cards are the page's own: the table card
 * (`rounded-2xl border-black/[0.06] bg-white shadow-sm overflow-hidden`, which
 * holds its own toolbar and column key) and the pending-invites card
 * (`rounded-2xl … p-5 shadow-sm` under a `text-xl` heading).
 *
 * Approximated because it is data: how many team members and pending invites
 * there are, and whether the page shows an alert instead of the table when the
 * read fails.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="relative mx-auto w-full max-w-6xl">
        <div className="pointer-events-none absolute inset-x-0 -top-1.5 bottom-0 z-40 lg:-top-2.5">
          <div className="sticky top-3 flex justify-end lg:top-3.5">
            <div className="w-full lg:w-[440px]">
              <Skeleton className="h-16 w-full rounded-full" />
            </div>
          </div>
        </div>

        <div className="space-y-10">
          {/* Heading with the invite control pinned to the rail's edge */}
          <div className="flex flex-wrap items-start justify-between gap-4 pt-[76px] lg:pr-[472px] lg:pt-0">
            <Skeleton className="h-[1em] w-64 max-w-full text-[clamp(2rem,4vw,2.75rem)] leading-none" />
            <Skeleton className="h-10 w-36 shrink-0 rounded-full" />
          </div>

          {/* The team table: its own toolbar, then the column key and rows */}
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] px-5 py-3.5">
                <Skeleton className="h-4 w-40" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-9 w-32 rounded-full" />
                  <Skeleton className="h-9 w-28 rounded-full" />
                </div>
              </div>
              <div className="hidden items-center gap-4 border-b border-black/[0.06] bg-black/[0.015] px-5 py-2.5 lg:flex">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="ml-auto h-3 w-16" />
              </div>
              <ul>
                {Array.from({ length: 6 }).map((_, index) => (
                  <li
                    key={index}
                    className="flex items-center gap-4 border-b border-black/[0.06] px-5 py-4 last:border-b-0"
                  >
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1">
                      <Skeleton className="h-5 w-40 max-w-full" />
                      <Skeleton className="mt-1 h-4 w-56 max-w-full" />
                    </div>
                    <Skeleton className="hidden h-6 w-20 shrink-0 rounded-full sm:block" />
                    <Skeleton className="hidden h-4 w-24 shrink-0 md:block" />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Pending invites */}
          <div className="mt-10 space-y-4">
            <Skeleton className="h-[30px] w-40" />
            <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
                  >
                    <Skeleton className="h-5 w-56 max-w-full" />
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-8 w-24 rounded-full" />
                      <Skeleton className="h-8 w-20 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
