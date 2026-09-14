import { Skeleton } from "@/components/ui/skeleton";

/**
 * F234 — mirrors page.tsx's shell: bone ground, an h1 with the shared tab row
 * under it, then the stack of cards.
 *
 * Rebuilt because the old version drew each card as a bare `h-20`/`h-80`/`h-72`
 * `bg-black/10` slab — a dark rectangle the size and position of a card, which is
 * the one thing a loading frame must not do, and the reason the swap read as a
 * flash rather than a fade.
 *
 * This screen is the *pre-migration* Charity Commission page and is still
 * entirely on the old card language: `rounded-2xl border-black/[0.07] bg-white
 * shadow-xs`, headings at `text-sm font-bold`, body at `p-5 sm:p-6`. The skeleton
 * follows the page it belongs to, not the converted screen next to it — so no
 * `rounded-panel` and no `border-rule` in here.
 *
 * Order matches the page: the pipelines guide, the register snapshot, the filter
 * builder (or, when nothing is staged, the single-charity lookup form).
 *
 * Approximated because it is data: whether the register is staged (which decides
 * between the two large cards), and how many saved filter sets there are.
 */

/** One of the old card's sections: a heading and a run of body. */
function LegacyCard({
  headingWidth = "w-40",
  lines = 3,
}: {
  headingWidth?: string;
  lines?: number;
}) {
  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
      <Skeleton className={`h-5 ${headingWidth} max-w-full`} />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }).map((_, index, all) => (
          <Skeleton
            key={index}
            className={`h-[22px] ${index === all.length - 1 ? "w-2/3" : "w-full"}`}
          />
        ))}
      </div>
    </section>
  );
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-5xl space-y-10">
        <div>
          <Skeleton className="h-[1em] w-72 max-w-full text-[clamp(2rem,4vw,2.75rem)] leading-none" />
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {["w-32", "w-28", "w-36", "w-24"].map((width, index) => (
              <Skeleton key={index} className={`h-8 rounded-full ${width}`} />
            ))}
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-[22px] w-full max-w-xl" />
            <Skeleton className="h-[22px] w-2/3 max-w-xl" />
          </div>
        </div>

        <div className="space-y-6">
          {/* How this works — a collapsible heading over its body */}
          <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-xs">
            <div className="flex w-full items-center justify-between gap-4 px-5 py-4 sm:px-6">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-5 shrink-0" />
            </div>
          </div>

          {/* Charity register — the snapshot's readings */}
          <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-32 rounded-full" />
            </div>
            <div className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
              {["w-32", "w-24", "w-28"].map((width, index) => (
                <div key={index}>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-1.5 h-7 w-16" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-4 h-[22px] w-80 max-w-full" />
          </section>

          {/* The filter builder, or the single-charity lookup that replaces it */}
          <LegacyCard headingWidth="w-44" lines={2} />
          <LegacyCard headingWidth="w-36" lines={4} />
          <LegacyCard headingWidth="w-28" lines={3} />
        </div>
      </div>
    </div>
  );
}
