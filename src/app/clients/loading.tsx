/** F051 AC3 — shown while the charity list fetches. */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-2 text-2xl font-bold">Clients</h1>
        <ul className="mt-8 animate-pulse divide-y divide-black/5" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <li key={index} className="flex items-center justify-between gap-4 py-4">
              <span className="h-4 w-48 rounded bg-black/10" />
              <span className="h-4 w-20 rounded bg-black/10" />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
