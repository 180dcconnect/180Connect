import { Skeleton, SkeletonPanel } from "@/components/ui/skeleton";
import { DataImportsHeader } from "@/app/admin/data-imports-header";

/**
 * Mirrors page.tsx's landing view — the import screens' `max-w-6xl space-y-8`
 * Stage, the heading block and its lede, then the recently-added and drafts
 * cards — so the real page swaps in without the header moving or the lists
 * resizing under it.
 *
 * The header is the real one, as on every Data imports tab: its tab row is
 * static links, so a grey bar standing in for it would be a worse lie than the
 * real thing, and switching tabs leaves it pixel-identical.
 *
 * The cards were `SkeletonCard` — `rounded-2xl border-black/[0.06] shadow-sm` —
 * but `RecentlyAdded` and `DraftList` are on the panel language
 * (`rounded-panel border-rule bg-white`, `px-5 py-4` header, `py-3` rows under a
 * `border-t border-rule-soft`), so the old slabs painted a radius, a border and a
 * shadow the page does not use. Same rows, panel chrome.
 *
 * Approximated because it is data: how many submissions and drafts the CAM has.
 * Each list is drawn at its usual few rows and at two lines per row.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <header>
          <DataImportsHeader current="/clients/new" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-[21px] w-full max-w-[62ch]" />
            <Skeleton className="h-[21px] w-3/4 max-w-[62ch]" />
          </div>
        </header>

        <div className="space-y-6">
          {/* Recently added — heading, its action, a row per submission, footer */}
          <SkeletonPanel padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
              <Skeleton className="h-[23px] w-40" />
              <Skeleton className="h-9 w-36 rounded-full" />
            </div>
            <ul className="divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 4 }).map((_, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3"
                >
                  <Skeleton className="h-5 w-56 max-w-full" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="ml-auto h-6 w-20 rounded-full" />
                </li>
              ))}
            </ul>
            <div className="border-t border-rule-soft px-5 py-3">
              <Skeleton className="h-4 w-40" />
            </div>
          </SkeletonPanel>

          {/* Drafts still in hand */}
          <SkeletonPanel padded={false}>
            <div className="px-5 py-4">
              <Skeleton className="h-[23px] w-32" />
            </div>
            <ul className="divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 2 }).map((_, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3"
                >
                  <Skeleton className="h-5 w-48 max-w-full" />
                  <Skeleton className="ml-auto h-7 w-24 rounded-full" />
                </li>
              ))}
            </ul>
          </SkeletonPanel>
        </div>
      </div>
    </div>
  );
}
