import { Skeleton, SkeletonStatCard } from "@/components/ui/skeleton";

/**
 * Mirrors the geometry of src/app/analytics/page.tsx, card-for-card, so the real
 * page lands underneath this without the layout shifting.
 *
 * Rewritten against `StatCard` and the page's own measurement cards rather than
 * from memory of them. Two things the old version had wrong, both visible on
 * every card: `StatCard`'s label is `text-[20px]` — a 30px line box, not the 12px
 * the `h-3` bar implied — and its bottom block is the 14px stick gauge over an
 * ~17px caption, not a 4px meter over a 12px one. Each of those moved the reading
 * 18px and the caption 5px inside a card that was otherwise the right size.
 *
 * This page is deliberately on the old card language still — `rounded-2xl
 * border-black/[0.06] shadow-sm` — so the skeleton is too. A skeleton matches the
 * page it belongs to, never the file next to it.
 *
 * Approximated because it is data: whether the page renders the empty state
 * instead of the groups (no clients owned yet), and the "slowest to come back"
 * list under the response-time card.
 */
export default function AnalyticsLoading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        {/* Eyebrow, then the h1 at its clamp */}
        <header>
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="mt-2 h-[1em] w-64 max-w-full text-[clamp(2rem,4vw,2.75rem)] leading-none" />
        </header>

        {/* Your outreach — three StatCards */}
        <section className="space-y-4">
          <Skeleton className="h-[30px] w-36" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SkeletonStatCard labelWidth="w-28" />
            <SkeletonStatCard labelWidth="w-32" />
            <SkeletonStatCard labelWidth="w-24" />
          </div>
        </section>

        {/* Converted against no response — one reading over a two-item dl */}
        <section className="space-y-4">
          <Skeleton className="h-[30px] w-64 max-w-full" />
          <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <Skeleton className="h-4 w-52 max-w-full" />
            <Skeleton className="mt-3 h-9 w-24" />
            <div className="mt-5 flex gap-8">
              {["w-20", "w-24"].map((width, index) => (
                <div key={index}>
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="mt-1 h-7 w-16" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-4 h-4 w-72 max-w-full" />
          </div>
        </section>

        {/* Typical response time — same card, a three-item dl and a slowest list */}
        <section className="space-y-4">
          <Skeleton className="h-[30px] w-56 max-w-full" />
          <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <Skeleton className="h-4 w-60 max-w-full" />
            <Skeleton className="mt-3 h-9 w-28" />
            <div className="mt-5 flex flex-wrap gap-8">
              {["w-16", "w-20", "w-16"].map((width, index) => (
                <div key={index}>
                  <Skeleton className={`h-4 ${width}`} />
                  <Skeleton className="mt-1 h-7 w-16" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-4 h-4 w-80 max-w-full" />
            <div className="mt-6 border-t border-black/[0.06] pt-4">
              <Skeleton className="h-4 w-40" />
              <div className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex flex-wrap items-baseline justify-between gap-2"
                  >
                    <Skeleton className="h-5 w-48 max-w-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* What tone works — the tone table */}
        <section className="space-y-4">
          <Skeleton className="h-[30px] w-40" />
          <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <Skeleton className="h-4 w-64 max-w-full" />
            <div className="mt-4 divide-y divide-black/[0.06] border-t border-black/[0.06]">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] gap-4 py-3"
                >
                  <Skeleton className="h-5 w-40 max-w-full" />
                  <Skeleton className="h-5 w-12 justify-self-end" />
                  <Skeleton className="h-5 w-12 justify-self-end" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
