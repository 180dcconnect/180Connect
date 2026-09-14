import { Skeleton, SkeletonListPanel } from "@/components/ui/skeleton";

/** F181 — Loading skeleton for Approvals Tab. */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Skeleton className="h-4 w-28" />
            {/* The h1 is `text-3xl`, 36px of line box. */}
            <Skeleton className="mt-1 h-9 w-48" />
            <Skeleton className="mt-3 h-5 w-96 max-w-full" />
          </div>
          <Skeleton className="h-5 w-24" />
        </div>

        <div className="mt-8 flex gap-3 border-b border-black/10 pb-3">
          <Skeleton className="h-9 w-36 rounded-lg" />
          <Skeleton className="h-9 w-36 rounded-lg" />
        </div>

        <SkeletonListPanel className="mt-6" rows={4} />
      </section>
    </main>
  );
}
