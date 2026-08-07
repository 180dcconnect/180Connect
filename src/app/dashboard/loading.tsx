/** F021 AC — shown while dashboard metrics fetch. */
export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-2 text-2xl font-bold">Dashboard</h1>
        <div className="mt-6 grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-black/10 p-4">
              <span className="block h-7 w-12 rounded bg-black/10" />
              <span className="mt-2 block h-4 w-20 rounded bg-black/10" />
            </div>
          ))}
        </div>
        <div className="mt-8 animate-pulse" aria-hidden="true">
          <span className="block h-5 w-32 rounded bg-black/10" />
          <ul className="mt-3 divide-y divide-black/5">
            {Array.from({ length: 3 }).map((_, index) => (
              <li key={index} className="flex items-center justify-between gap-4 py-3">
                <span className="h-4 w-48 rounded bg-black/10" />
                <span className="h-4 w-20 rounded bg-black/10" />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
