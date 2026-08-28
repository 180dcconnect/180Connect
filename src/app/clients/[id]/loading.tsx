import { Skeleton } from "@/components/ui/skeleton";

/**
 * F234 — mirrors page.tsx's shell: back link, the charcoal hero band, the
 * at-a-glance strip, then the two-column card grid. The hero renders as a dark
 * block so the page doesn't flash white before content arrives.
 */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f4f4ef] p-6 sm:p-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-48 w-full rounded-3xl bg-[#1c1a18]/90" />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-44 w-full rounded-2xl" />
            ))}
          </div>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-36 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
