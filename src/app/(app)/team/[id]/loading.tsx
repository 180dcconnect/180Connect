import { Skeleton, SkeletonSectionCard } from "@/components/ui/skeleton";

/**
 * Shown while a team member's profile fetches. Mirrors page.tsx's shell (bone
 * ground, 1400px column) so the swap-in doesn't jump.
 *
 * This route runs seven queries in one `Promise.all` plus a conditional inviter
 * lookup, and had no loading state at all — a slow render left the previous screen
 * sitting there with nothing to say a navigation had happened.
 *
 * Rebuilt because the old version drew its three tiles with `SkeletonCard` — the
 * *old* card language, `rounded-2xl border-black/[0.06] shadow-sm`. This profile is
 * fully converted: `TeamMemberHeader` is `rounded-panel border-rule bg-white
 * shadow-xs` with an `size-16` avatar and a `px-5 py-6` body, and the view's four
 * stat tiles are `rounded-panel … p-5 shadow-xs` over a `grid-cols-2 sm:grid-cols-4`.
 * The wrong radius and the wrong shadow on the first thing on the page is exactly
 * the seam this pass exists to remove.
 *
 * Order matches the page: the member header, the tab pill row, the four stat
 * tiles, then the panel pairs.
 *
 * Approximated because it is data: how many assigned clients, notes and activities
 * this member has, and which tab they are on.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        {/* The member header: its own top bar, then the avatar and identity */}
        <section className="rounded-panel border border-rule bg-white shadow-xs">
          <div className="flex items-center justify-between gap-3 border-b border-rule-soft px-5 py-2.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8.5 w-28 rounded-full" />
          </div>
          <div className="grid items-start gap-x-8 gap-y-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex items-start gap-4">
              <Skeleton className="size-16 shrink-0 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-[1em] w-72 max-w-full text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1]" />
                <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                  <Skeleton className="h-7 w-24 rounded-full" />
                  <Skeleton className="h-7 w-32 rounded-full" />
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-3">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-center gap-2 self-center py-1">
              <Skeleton className="h-10 w-32 rounded-full" />
              <Skeleton className="h-10 w-28 rounded-full" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-rule-soft bg-paper/40 px-5 py-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </section>

        {/* The tab pill row */}
        <div className="inline-flex max-w-full items-center gap-1 rounded-full border border-lead/10 bg-lead-wash/50 p-1">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-24 rounded-full" />
          ))}
        </div>

        {/* The four stat tiles */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-panel border border-rule bg-white p-5 shadow-xs"
            >
              <Skeleton className="h-4 w-24 max-w-full" />
              <Skeleton className="mt-3 h-9 w-20" />
              <Skeleton className="mt-2 h-4 w-28 max-w-full" />
              <Skeleton className="mt-4 h-3.5 w-full rounded-full" />
            </div>
          ))}
        </div>

        {/* The list panels, in the page's own two-column arrangement */}
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <SkeletonSectionCard titleWidth="w-40" hintWidth="w-64">
            <ul className="mt-3.5 divide-y divide-rule/40 overflow-hidden rounded-panel border border-rule bg-white">
              {Array.from({ length: 5 }).map((_, index) => (
                <li key={index} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-5 w-48 max-w-full" />
                    <Skeleton className="mt-1 h-4 w-32" />
                  </div>
                  <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
                </li>
              ))}
            </ul>
          </SkeletonSectionCard>
          <SkeletonSectionCard titleWidth="w-28" hintWidth="w-48">
            <div className="mt-3.5 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-start gap-3">
                  <Skeleton className="mt-1 size-2 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="mt-1 h-3.5 w-24" />
                  </div>
                </div>
              ))}
            </div>
          </SkeletonSectionCard>
        </div>
      </div>
    </div>
  );
}
