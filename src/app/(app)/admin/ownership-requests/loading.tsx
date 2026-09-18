import { Skeleton } from "@/components/ui/skeleton";

import { AdminCardLoading } from "../admin-card-loading";

/**
 * Mirrors page.tsx: heading, then the Pending list. Approximated because it is
 * data: how many requests are waiting, and whether any have been decided.
 */
export default function Loading() {
  return (
    <AdminCardLoading width="max-w-4xl" title="Ownership requests">
      <div className="mt-8 space-y-10">
        <div className="min-h-6" />
        <div>
          <Skeleton className="h-4 w-20" />
          <div className="mt-4 space-y-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </AdminCardLoading>
  );
}
