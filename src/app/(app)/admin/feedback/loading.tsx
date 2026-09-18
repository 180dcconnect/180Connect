import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors page.tsx: the "Feedback" heading and line of copy (fixed, so drawn)
 * beside the request button, the summary strip, the response count, then the
 * response cards. Approximated because it is data: how many responses exist.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-5xl space-y-10">
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0">
              <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
                Feedback
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-[1.7] text-foreground/65">
                Ratings are collected periodically via the in-app prompt.
              </p>
            </div>
            <Skeleton className="h-10 w-44 rounded-full" />
          </div>

          <div
            aria-hidden="true"
            className="rounded-2xl border border-black/[0.06] bg-white px-6 py-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-[38px] rounded-full" />
                <div>
                  <Skeleton className="h-8 w-12" />
                  <Skeleton className="mt-1 h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-14 min-w-[180px] flex-1 rounded-md" />
            </div>
          </div>
        </div>

        <div aria-hidden="true" className="space-y-3">
          <Skeleton className="h-3 w-24" />
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-black/[0.06] bg-white px-5 py-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div>
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-1 h-3 w-20" />
                  </div>
                </div>
                <Skeleton className="h-5 w-10 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
