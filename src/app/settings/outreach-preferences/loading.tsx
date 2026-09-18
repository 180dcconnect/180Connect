import { Skeleton } from "@/components/ui/skeleton";

/**
 * F234 — mirrors page.tsx while the preferences load: bone ground, full-width
 * column (no `max-w`, per the design doc), the heading and its facts rail, then
 * the summary view's two cards — "What your queue favours" with four rows and
 * "Follow-up timing" with two.
 *
 * Approximated because it is data: how many chips each row holds, and whether
 * the page shows its load-failed alert instead.
 */
function SkeletonRows({ widths }: { widths: string[][] }) {
  return (
    <div className="mt-4">
      {widths.map((chips, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 border-t border-rule-soft py-3.5 sm:flex-row sm:items-center sm:gap-8"
        >
          <Skeleton className="h-4 w-32 sm:w-48 sm:shrink-0" />
          <div className="flex flex-1 flex-wrap gap-1.5">
            {chips.map((width, chip) => (
              <Skeleton key={chip} className={`h-6 rounded-full ${width}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="w-full space-y-8">
        <div>
          <Skeleton className="h-[1em] w-72 text-[clamp(2rem,4vw,2.75rem)] leading-none" />
          <Skeleton className="mt-5 h-5 w-80" />
        </div>

        <div className="space-y-4">
          <section className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="mt-2 h-4 w-3/4" />
            <SkeletonRows
              widths={[
                ["w-16", "w-24", "w-20"],
                ["w-28", "w-32"],
                ["w-24"],
                ["w-40"],
              ]}
            />
          </section>

          <section className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-2 h-4 w-2/3" />
            <SkeletonRows widths={[["w-3/4"], ["w-4/5"]]} />
          </section>
        </div>
      </div>
    </div>
  );
}
