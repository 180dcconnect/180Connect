import { Skeleton, SkeletonListPanel } from "@/components/ui/skeleton";

/** F234 — mirrors page.tsx's shell (single white card on the admin ground). */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Skeleton className="h-4 w-28" />
            {/* The h1 is `text-3xl`, 36px of line box. */}
            <Skeleton className="mt-2 h-9 w-64" />
            <Skeleton className="mt-3 h-5 w-96 max-w-full" />
          </div>
        </div>

        <SkeletonListPanel className="mt-8" rows={5} />
      </section>
    </main>
  );
}
