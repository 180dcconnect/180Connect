import { Skeleton } from "@/components/ui/skeleton";

/** F234 — mirrors page.tsx's shell (single white card on the settings ground). */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          </div>
        </div>

        <Skeleton className="mt-8 h-24 w-full rounded-xl" />
        <Skeleton className="mt-4 h-24 w-full rounded-xl" />
        <Skeleton className="mt-4 h-24 w-full rounded-xl" />
      </section>
    </main>
  );
}
