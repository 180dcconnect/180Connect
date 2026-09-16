import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx's shell (bone ground, 5xl column) and the panel beneath it,
 * while the users and preferences reads run.
 *
 * Rewritten from the panel rather than from a guess: the old version drew one
 * `SkeletonListPanel` where `CamSettingsPanel` renders a team-member selector card
 * (`rounded-2xl border-black/[0.06] bg-white p-6 shadow-sm` with an avatar row),
 * a `text-xl` heading with the queue-order note beside it, an explanatory box, and
 * then the three focus cards side by side — geographic, organisation size and
 * sector, each `rounded-2xl … p-6 shadow-sm` with a `text-base` heading and its
 * chips. One six-row list was nothing like that.
 *
 * The heading keeps its `flex-wrap items-end justify-between` row, with the
 * back button's slot held on the right.
 *
 * Approximated because it is data: which member is selected, and how many chips
 * each focus card holds.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <Skeleton className="h-[1em] w-72 max-w-full text-[clamp(2rem,4vw,2.75rem)] leading-none" />
            <div className="mt-3 max-w-2xl space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          </div>
          <Skeleton className="h-10 w-32 shrink-0 rounded-full" />
        </div>

        {/* The team-member selector */}
        <div className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <div className="min-w-0">
                <Skeleton className="h-6 w-48 max-w-full" />
                <Skeleton className="mt-1.5 h-4 w-64 max-w-full" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-7 w-28 rounded-full" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          </div>
        </div>

        {/* The queue heading, its note, and the explanation */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Skeleton className="h-[30px] w-52" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm">
            <Skeleton className="h-5 w-full max-w-2xl" />
            <Skeleton className="mt-2 h-5 w-2/3" />
          </div>
        </div>

        {/* Geographic focus, organisation size, sector — three cards in a row */}
        <div className="grid gap-6 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex h-full flex-col rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-6 w-40 max-w-full" />
                <Skeleton className="h-7 w-20 shrink-0 rounded-full" />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {["w-20", "w-24", "w-16", "w-28"].map((width, chipIndex) => (
                  <Skeleton
                    key={chipIndex}
                    className={`h-7 rounded-lg ${width}`}
                  />
                ))}
              </div>
              <Skeleton className="mt-5 h-12 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
