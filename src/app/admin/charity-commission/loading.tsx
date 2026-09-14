import { Skeleton, SkeletonSectionCard } from "@/components/ui/skeleton";
import { DataImportsHeader } from "../data-imports-header";

/**
 * Mirrors page.tsx's shell: bone ground, the real Data imports header, then the
 * console's home view — the recent-imports card, and the annual-return card that
 * appears once the register is staged.
 *
 * The old version drew three bare `bg-black/10` slabs (`h-40`, `h-40`, `h-56`)
 * where two white cards and a list belong, at a radius the cards do not use. Each
 * card here is its real self: recent imports is `rounded-2xl border-black/[0.07]
 * shadow-xs` with a `text-sm font-bold` heading at `px-5 py-4 sm:px-6` (this
 * screen is older than the panel language and still on it — the skeleton follows
 * the page, not the tab beside it), and the annual-return card is
 * `rounded-panel border-rule` like the rest of the newer half.
 *
 * The register rail inside the header is drawn as its usual two lines of
 * readings, and the whole header is real because its mark, title and tab row are
 * static.
 *
 * Approximated because it is data: how many recent imports there are, whether the
 * register is staged at all (an unstaged screen shows an alert instead of the
 * coverage card), and whether the imports read failed.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <DataImportsHeader current="/admin/charity-commission">
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <Skeleton className="h-4 w-40" />
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

          {/* Annual return coverage — the newer half of the page, on the panel */}
          <SkeletonSectionCard
            titleWidth="w-48"
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
        </div>
      </div>
    </div>
  );
}
