/**
 * Gmail skeleton for /inbox while data loads.
 */
export default function InboxLoading() {
  return (
    <div className="w-full px-2 sm:px-4 py-3">
      <div className="flex h-[calc(100vh-5.5rem)] w-full gap-2 font-sans bg-[#f6f8fc] p-2 rounded-2xl animate-pulse">
        {/* Sidebar skeleton */}
        <div className="w-56 flex flex-col shrink-0 pr-3 space-y-4">
          <div className="h-11 w-32 rounded-2xl bg-blue-100" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-8 rounded-r-full bg-slate-200/70 w-full" />
            ))}
          </div>
        </div>

        {/* Mail surface skeleton */}
        <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-4">
          <div className="h-10 rounded-full bg-slate-100 max-w-xl" />
          <div className="h-8 border-b border-slate-100 flex gap-4">
            <div className="h-6 w-24 rounded bg-slate-200/60" />
            <div className="h-6 w-24 rounded bg-slate-200/60" />
            <div className="h-6 w-24 rounded bg-slate-200/60" />
          </div>
          <div className="space-y-2 pt-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-slate-50 border border-slate-100 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
