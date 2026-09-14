import { Skeleton } from "@/components/ui/skeleton";

/**
 * F234 — mirrors page.tsx's shell while the preferences load: bone ground, the
 * `max-w-2xl` column, the h1 and its lede, then the form's sections.
 *
 * Rebuilt because the old version was on a different screen entirely — a
 * `bg-[#f1f2f4] p-6` ground with a single `max-w-xl rounded-2xl bg-white p-8`
 * card. This page is bone ground with a `max-w-2xl space-y-10` column and no
 * wrapper card at all: the form is a stack of `rounded-2xl border-black/[0.06]
 * bg-white px-6 py-6 shadow-sm` sections, two of which are side by side. The
 * ground, the column width and the card count were all wrong.
 *
 * Approximated because it is data: the chip counts in each picker, and whether
 * the page shows its load-failed alert instead of the form.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-2xl space-y-10">
        <div>
          <Skeleton className="h-[1em] w-72 max-w-full text-[clamp(2rem,4vw,2.75rem)] leading-none" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        </div>

        {/* Geography: the reach chips, then the cities */}
        <section className="rounded-2xl border border-black/[0.06] bg-white px-6 py-6 shadow-sm">
          <Skeleton className="h-6 w-40 max-w-full" />
          <Skeleton className="mt-2 h-4 w-64 max-w-full" />
          <div className="mt-3 flex flex-wrap gap-2">
            {["w-24", "w-28", "w-20", "w-32", "w-24"].map((width, index) => (
              <Skeleton key={index} className={`h-7 rounded-full ${width}`} />
            ))}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        </section>

        {/* Sector and income band, side by side on sm */}
        <section className="rounded-2xl border border-black/[0.06] bg-white px-6 py-6 shadow-sm">
          <Skeleton className="h-6 w-32 max-w-full" />
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="flex items-start gap-3 rounded-xl border border-black/[0.08] bg-white p-3"
              >
                <Skeleton className="mt-0.5 size-4 shrink-0 rounded" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-1 h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-black/[0.08] bg-white p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-10 w-full rounded-lg" />
            </div>
            <div className="rounded-xl border border-black/[0.08] bg-white p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-10 w-full rounded-lg" />
            </div>
          </div>
        </section>

        {/* Follow-up cadence and the save control */}
        <section className="rounded-2xl border border-black/[0.06] bg-white px-6 py-6 shadow-sm">
          <Skeleton className="h-6 w-44 max-w-full" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Skeleton className="h-10 w-32 rounded-lg" />
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
          <Skeleton className="mt-5 h-11 w-40 rounded-full" />
        </section>
      </div>
    </div>
  );
}
