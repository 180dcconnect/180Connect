/**
 * Skeleton for /inbox. Mirrors the queue's real geometry — title, filter row,
 * one bucket heading, a list of rows — so the page does not reflow when the
 * data lands.
 */
export default function InboxLoading() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <div className="mx-auto w-full max-w-[1400px] animate-pulse space-y-6">
        <div className="space-y-2.5">
          <div className="h-9 w-40 rounded-inset bg-paper-sunk" />
          <div className="h-4 w-[36ch] max-w-full rounded-inset bg-paper" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-6 w-16 rounded-full bg-paper" />
            ))}
          </div>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-6 w-24 rounded-full bg-paper" />
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="h-5 w-32 rounded-inset bg-paper-sunk" />
          <ul className="divide-y divide-rule-soft overflow-hidden rounded-panel border border-rule bg-white">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3.5 w-48 rounded-inset bg-paper-sunk" />
                  <div className="h-3 w-[42ch] max-w-full rounded-inset bg-paper" />
                  <div className="h-2.5 w-56 rounded-inset bg-paper" />
                </div>
                <div className="h-5 w-20 shrink-0 rounded-full bg-paper" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
