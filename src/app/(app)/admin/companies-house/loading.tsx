import { Skeleton, SkeletonSectionCard } from "@/components/ui/skeleton";
import { DataImportsHeader } from "../data-imports-header";

/**
 * Mirrors page.tsx's shell: bone ground, the real Data imports header with its
 * companies register rail, then the console's home view — recent imports, the CIC
 * statement card, and the guide.
 *
 * Rebuilt because the old version drew a `SkeletonCard` (the *old* card language,
 * `rounded-2xl border-black/[0.06] shadow-sm`) and a `rounded-2xl` grey slab
 * where the guide's `rounded-2xl border-black/[0.07] shadow-xs` card belongs —
 * the right radius on the wrong paint, and a dark block where a white one should
 * be. The cards are now their real selves with bars for words, and the recent
 * imports rows match the `px-5 py-3.5 sm:px-6` cadence the list actually uses.
 *
 * The header is rendered for real: mark, title and tab row are all static, and
 * the register rail beneath them is drawn as its lines of readings.
 *
 * Approximated because it is data: how many recent imports there are, whether
 * the register is staged (an unstaged screen shows an alert where the CIC card
 * would be), and whether the imports read failed.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <DataImportsHeader current="/admin/companies-house">
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-36 rounded-full" />
            </div>
          </DataImportsHeader>
        </div>

        <div className="space-y-4">
          {/* Recent imports */}
          <section className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-36 rounded-full" />
            </div>
            <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
              {Array.from({ length: 5 }).map((_, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 sm:px-6"
                >
                  <Skeleton className="h-5 w-44 max-w-full" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="ml-auto h-6 w-24 shrink-0 rounded-full" />
                </li>
              ))}
            </ul>
          </section>

          {/* CIC statements — the newer half of the page, on the panel */}
          <SkeletonSectionCard
            titleWidth="w-52"
            titleHeight="h-[25px]"
            hintWidth="w-80"
          >
            <div className="mt-5 space-y-4">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-2.5 w-full rounded-full" />
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Skeleton className="h-11 w-40 rounded-full" />
              </div>
            </div>
          </SkeletonSectionCard>

          {/* How company imports work — the guide is still on the old card
              (`rounded-2xl border-black/[0.07] px-5 py-4 shadow-xs`), with a
              `text-sm font-bold` heading over its prose. */}
          <section className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white px-5 py-4 shadow-xs sm:px-6">
            <Skeleton className="h-5 w-56 max-w-full" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-[22px] w-full" />
              <Skeleton className="h-[22px] w-11/12" />
              <Skeleton className="h-[22px] w-2/3" />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
