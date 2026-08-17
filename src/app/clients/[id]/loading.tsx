/**
 * F071: this route had no loading state before — every section (basic info,
 * ownership, sources, notes) fetches in one Server Component pass, so a client
 * with a long note history could otherwise sit on a blank page for longer than
 * the list view ever does. Mirrors page.tsx's own chrome (`min-h-screen
 * bg-[#f1f2f4] p-6` / `max-w-2xl rounded-2xl bg-white p-8`) so the swap-in on
 * load doesn't jump, same idiom as src/app/clients/loading.tsx.
 */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <div className="mx-auto w-full max-w-2xl animate-pulse rounded-2xl bg-white p-8 shadow-sm" aria-hidden="true">
        <div className="h-4 w-16 rounded bg-black/10" />
        <div className="mt-4 h-7 w-2/3 rounded bg-black/10" />

        <div className="mt-6 h-24 rounded-xl border border-black/10 bg-black/5" />
        <div className="mt-6 h-16 rounded-xl border border-black/10 bg-black/5" />
        <div className="mt-6 h-16 rounded-xl border border-black/10 bg-black/5" />

        <div className="mt-6">
          <div className="h-4 w-16 rounded bg-black/10" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-16 rounded-lg border border-black/10 bg-black/5" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
