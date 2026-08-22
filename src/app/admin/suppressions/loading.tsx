import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** F234 — mirrors page.tsx's shell (single white card on the admin ground). */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-7 w-80 max-w-full" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-1 h-4 w-2/3" />

        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonCard key={index}>
              <Skeleton className="h-4 w-64 max-w-full" />
              <Skeleton className="mt-2 h-3 w-40" />
            </SkeletonCard>
          ))}
        </div>
      </section>
    </main>
  );
}
