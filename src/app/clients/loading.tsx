/** F051 AC3 — shown while the charity list fetches. Mirrors page.tsx's card shape
 * (bone ground, floating white cards) so the swap-in on load doesn't jump. */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-4xl space-y-8">
        <div>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-black leading-[1] tracking-[-0.03em]">
            Clients
          </h1>
        </div>

        <div
          className="h-[76px] animate-pulse rounded-2xl border border-black/[0.06] bg-white shadow-sm"
          aria-hidden="true"
        />

        <ul
          className="animate-pulse divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm"
          aria-hidden="true"
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <li key={index} className="flex items-center justify-between gap-4 px-5 py-4">
              <span className="h-4 w-48 rounded bg-black/10" />
              <span className="h-4 w-20 rounded-full bg-black/10" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
