import { Skeleton } from "@/components/ui/skeleton";

import { AdminCardLoading } from "../admin-card-loading";

/**
 * Mirrors page.tsx: the "Admin workspace" eyebrow and heading, then the
 * submissions as bordered article cards. Approximated because it is data: how
 * many entries there are, and which carry a review form.
 */
export default function Loading() {
  return (
    <AdminCardLoading width="max-w-5xl" eyebrow="Admin workspace" title="Manual client entries">
      <div className="mt-6 space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-black/10 p-5">
            <div className="flex flex-wrap justify-between gap-2">
              <Skeleton className="h-5 w-56 max-w-full" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="mt-2 h-4 w-72 max-w-full" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-5/6" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-32 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </AdminCardLoading>
  );
}
