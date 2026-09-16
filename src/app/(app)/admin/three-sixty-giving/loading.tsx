import { Skeleton, SkeletonSectionCard } from "@/components/ui/skeleton";
import { DataImportsHeader } from "../data-imports-header";

/**
 * Mirrors page.tsx's shell: bone ground, the real Data imports header, then the
 * three cards the page renders — the backfill card, recent runs, and the guide.
 *
 * Rebuilt because the old version drew each card as one `h-64`/`h-72`
 * `bg-black/10` slab. Every card on this page is `rounded-panel border-rule
 * bg-white` with a `text-[19px]` heading at `px-5 py-5 sm:px-6`, so two dark
 * rectangles where white titled cards belong was the whole difference the eye
 * caught on swap. The cards are now themselves, with bars where the words go.
 *
 * The header is the real one: its mark, title and tab row are static, and a grey
 * bar standing in for it would be a worse lie than the real thing.
 *
 * Approximated because it is data: the backfill progress numbers and how many
 * recent runs there are. Drawn at the four rows the runs card usually holds.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <DataImportsHeader current="/admin/three-sixty-giving">
            <div className="mt-3 max-w-xl space-y-2">
              <Skeleton className="h-[22px] w-full" />
              <Skeleton className="h-[22px] w-4/5" />
            </div>
          </DataImportsHeader>
        </div>

        <div className="space-y-6">
          {/* Backfill — heading, the progress reading, the batch controls */}
          <SkeletonSectionCard
            titleWidth="w-40"
            titleHeight="h-[25px]"
            hintWidth="w-72"
          >
            <div className="mt-5 space-y-4">
              <Skeleton className="h-9 w-48" />
              <Skeleton className="h-2.5 w-full rounded-full" />
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Skeleton className="h-11 w-40 rounded-full" />
                <Skeleton className="h-11 w-32 rounded-full" />
              </div>
            </div>
          </SkeletonSectionCard>

          {/* Recent runs — a heading row, then a row per run */}
          <SkeletonSectionCard
            titleWidth="w-32"
            titleHeight="h-[25px]"
            padded={false}
          >
            <ul className="divide-y divide-rule-soft border-t border-rule-soft">
              {Array.from({ length: 4 }).map((_, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 sm:px-6"
                >
                  <Skeleton className="h-5 w-40 max-w-full" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="ml-auto h-6 w-24 shrink-0 rounded-full" />
                </li>
              ))}
            </ul>
          </SkeletonSectionCard>

          {/* The grants guide — a collapsible heading over three lines of prose */}
          <SkeletonSectionCard
            titleWidth="w-44"
            titleHeight="h-[25px]"
            padded={false}
          >
            <div className="space-y-2 border-t border-rule-soft px-5 py-5 sm:px-6">
              <Skeleton className="h-[22px] w-full" />
              <Skeleton className="h-[22px] w-11/12" />
              <Skeleton className="h-[22px] w-3/4" />
            </div>
          </SkeletonSectionCard>
        </div>
      </div>
    </div>
  );
}
