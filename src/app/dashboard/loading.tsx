/**
 * F021 AC — shown while dashboard metrics fetch. Deliberately the same skeleton
 * *geometry* as page.tsx (bone ground, card grid, list panel) so the real screen
 * lands on top of it rather than replacing a differently-shaped one.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Dashboard
          </h1>
        </div>

        <div className="animate-pulse space-y-4" aria-hidden="true">
          <span className="block h-4 w-24 rounded bg-black/10" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"
              >
                <span className="block h-3 w-20 rounded bg-black/10" />
                <span className="mt-3 block h-9 w-16 rounded bg-black/10" />
                <span className="mt-4 block h-1 w-full rounded-full bg-black/[0.07]" />
                <span className="mt-2 block h-3 w-24 rounded bg-black/10" />
              </div>
            ))}
          </div>
        </div>

        <div className="animate-pulse space-y-4" aria-hidden="true">
          <span className="block h-4 w-32 rounded bg-black/10" />
          <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
            <ul className="divide-y divide-black/[0.06]">
              {Array.from({ length: 3 }).map((_, index) => (
                <li key={index} className="flex items-center gap-4 px-5 py-4">
                  <span className="h-3 w-6 shrink-0 rounded bg-black/10" />
                  <span className="h-4 flex-1 rounded bg-black/10" />
                  <span className="h-5 w-24 shrink-0 rounded-full bg-black/10" />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="animate-pulse space-y-4" aria-hidden="true">
          <span className="block h-4 w-36 rounded bg-black/10" />
          <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
            <ul className="divide-y divide-black/[0.06]">
              {Array.from({ length: 3 }).map((_, index) => (
                <li key={index} className="flex items-center gap-4 px-5 py-4">
                  <span className="h-3 w-6 shrink-0 rounded bg-black/10" />
                  <span className="h-4 flex-1 rounded bg-black/10" />
                  <span className="h-5 w-20 shrink-0 rounded-full bg-black/10" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
