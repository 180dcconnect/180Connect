import { Skeleton } from "@/components/ui/skeleton";

/** F234 — mirrors page.tsx's shell (single white card on the admin ground). */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-8 w-80 max-w-full" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-1 h-4 w-3/4" />

        <Skeleton className="mt-6 h-11 w-full rounded-lg" />
        <Skeleton className="mt-4 h-40 w-full rounded-xl" />
      </section>
    </main>
  );
}
