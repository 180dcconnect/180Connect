/**
 * F021 AC — shown while dashboard metrics fetch. Deliberately the same skeleton
 * *geometry* as page.tsx (bone ground, hero metric card, three-stat grid,
 * three feed panels) so the real screen lands on top of it rather than
 * replacing a differently-shaped one. Mirrors StatCard, the lg
 * ProgressMetricCard (showFooter={false}) and the AttentionList/feed row shapes.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        {/* Heading + "View all clients" pill */}
        <div className="animate-pulse" aria-hidden="true">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <span className="block h-[1em] w-64 max-w-full self-center rounded bg-black/10 text-[clamp(2rem,4vw,2.75rem)] leading-none" />
            <span className="h-10 w-40 shrink-0 rounded-full bg-black/10" />
          </div>
        </div>

        {/* Hero metric: full-width lg ProgressMetricCard, no footer */}
        <div aria-hidden="true">
          <div className="relative flex min-h-[320px] w-full animate-pulse flex-col overflow-hidden rounded-[28px] border border-black/[0.06] bg-white shadow-sm sm:min-h-[460px]">
            <div className="flex flex-1 flex-col px-5 pt-6 sm:px-10 sm:pt-9">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span className="block h-5 w-44 rounded bg-black/10 sm:h-6" />
                <span className="block h-5 w-28 rounded-full bg-black/10" />
              </div>
              <span className="mt-5 block h-12 w-56 max-w-full rounded-lg bg-black/10 sm:h-[88px] sm:w-72" />
            </div>
          </div>
        </div>

        {/* Three StatCards */}
        <div
          className="grid animate-pulse gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-hidden="true"
        >
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"
            >
              <span className="block h-3 w-24 rounded bg-black/10" />
              <span className="mt-3 block h-9 w-16 rounded bg-black/10" />
              <span className="mt-4 block h-1 w-full rounded-full bg-black/10" />
              <span className="mt-2 block h-3 w-28 rounded bg-black/10" />
            </div>
          ))}
        </div>

        {[
          { titleWidth: "w-40", captionWidth: "w-48", rows: 4 },
          { titleWidth: "w-36", captionWidth: "w-40", rows: 3 },
          { titleWidth: "w-52", captionWidth: "w-36", rows: 3 },
        ].map((section, sectionIndex) => (
          <div key={sectionIndex} className="animate-pulse space-y-4" aria-hidden="true">
            <div className="flex items-baseline justify-between gap-4">
              <span className={`block h-6 ${section.titleWidth} rounded bg-black/10`} />
              <span
                className={`hidden h-3 ${section.captionWidth} rounded bg-black/10 sm:block`}
              />
            </div>
            <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
              <ul className="divide-y divide-black/[0.06]">
                {Array.from({ length: section.rows }).map((_, rowIndex) => (
                  <li key={rowIndex} className="flex items-center gap-4 px-5 py-4">
                    <span className="h-3 w-6 shrink-0 rounded bg-black/10" />
                    <div className="min-w-0 flex-1">
                      <span className="block h-4 w-2/3 rounded bg-black/10" />
                      <span className="mt-1.5 block h-3 w-24 rounded bg-black/10" />
                    </div>
                    <span className="h-5 w-20 shrink-0 rounded-full bg-black/10" />
                    <span className="h-4 w-4 shrink-0 rounded bg-black/10" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
