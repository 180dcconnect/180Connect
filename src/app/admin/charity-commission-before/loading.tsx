import { Skeleton } from "@/components/ui/skeleton";

/**
 * F234 — mirrors page.tsx's shell: bone ground, a heading and tab row, then the
 * stack of white cards. The card heights approximate the real ones so the page
 * does not jump when it arrives.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-5xl space-y-10">
        <div>
          <Skeleton className="h-10 w-72 max-w-full" />
          <Skeleton className="mt-4 h-8 w-80 max-w-full rounded-full" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>

        <div className="space-y-6">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-80 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
