import { Skeleton, SkeletonListPanel } from "@/components/ui/skeleton";

/** F234 — mirrors page.tsx's shell (single white card on the admin ground). */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-8 w-72" />
            <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          </div>
        </div>

        <Skeleton className="mt-8 h-14 w-full rounded-xl" />
        <Skeleton className="mt-4 h-24 w-full rounded-xl" />

        <div className="mt-8">
          <Skeleton className="h-5 w-32" />
          <SkeletonListPanel className="mt-3" rows={4} />
        </div>
      </section>
    </main>
  );
}
