import { Skeleton } from "@/components/ui/skeleton";

/** F234 — mirrors page.tsx's shell (single white card, stacked field sections). */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-4 h-7 w-3/4" />

        <Skeleton className="mt-6 h-32 w-full rounded-xl" />

        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="mt-6 rounded-xl border border-black/10 p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        ))}
      </section>
    </main>
  );
}
