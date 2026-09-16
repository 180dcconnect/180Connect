import { Skeleton } from "@/components/ui/skeleton";

import { AdminCardLoading } from "../admin-card-loading";

/** Mirrors page.tsx: heading, then the "sent today" strip and the limit form. */
export default function Loading() {
  return (
    <AdminCardLoading width="max-w-2xl" title="Outreach sending limit">
      <div className="mt-6">
        <Skeleton className="h-11 w-full rounded-lg" />
        <div className="mt-5 rounded-xl border border-black/10 bg-black/[0.015] p-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2 h-10 w-full rounded-lg" />
          <Skeleton className="mt-3 h-9 w-24 rounded-full" />
        </div>
      </div>
    </AdminCardLoading>
  );
}
