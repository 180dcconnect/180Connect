/**
 * Skeleton for /inbox. Mirrors the mailbox's geometry — folder rail, search
 * bar, category tabs, a list of thread rows — so the page does not reflow when
 * the threads land.
 */
export default function InboxLoading() {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f6f8fc]">
      <div className="flex h-full min-h-0 animate-pulse gap-3 py-2 pr-2 sm:pr-4">
        {/* Folder rail */}
        <div className="hidden w-[15rem] shrink-0 flex-col gap-2 px-3 pt-4 sm:flex">
          <div className="h-11 w-32 rounded-full bg-white/80" />
          <div className="mt-3 space-y-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 rounded-full bg-white/60" />
            ))}
          </div>
          <div className="mt-6 space-y-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 w-3/4 rounded-full bg-white/50" />
            ))}
          </div>
        </div>

        {/* Search bar + thread list */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="h-[3.25rem] shrink-0 rounded-full bg-white/70" />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-black/[0.06] bg-white">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-black/[0.06] px-4 py-3">
              <div className="h-4 w-24 rounded-inset bg-black/[0.05]" />
              <div className="h-4 w-20 rounded-inset bg-black/[0.04]" />
            </div>
            <div className="flex shrink-0 gap-6 border-b border-black/[0.06] px-4 py-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-4 w-28 rounded-inset bg-black/[0.05]" />
              ))}
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-black/[0.05]">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                <li key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="h-4 w-4 shrink-0 rounded-sm bg-black/[0.06]" />
                  <div className="h-4 w-4 shrink-0 rounded-full bg-black/[0.05]" />
                  <div className="h-3.5 w-40 shrink-0 rounded-inset bg-black/[0.07]" />
                  <div className="h-3.5 min-w-0 flex-1 rounded-inset bg-black/[0.04]" />
                  <div className="h-5 w-28 shrink-0 rounded-full bg-black/[0.05]" />
                  <div className="h-3 w-12 shrink-0 rounded-inset bg-black/[0.04]" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
