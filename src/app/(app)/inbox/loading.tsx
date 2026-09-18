import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton for /inbox.
 *
 * Rebuilt against `GmailInboxShell` rather than the old mailbox it was drawn for.
 * The previous version put a 15rem folder rail *and* its own search pill inside
 * two nested padding wrappers, guessed at the rail's width, and drew the thread
 * rows as six unevenly-padded bars — the shell has since settled on a 16rem
 * (`w-64`) rail inside `main`'s `py-2 pr-2`, a 64px `BrandSearchBar` sharing a
 * row with a 48px Compose button, and rows at a fixed track. Every box below is
 * taken from the component it stands in for.
 *
 * The shell already renders an eight-row pulse while it re-fetches (its own
 * `isRefreshing` branch), and those rows are copied here exactly — same
 * `px-3 py-3` cadence, same `w-48`/`w-28` end columns — so the two loading states
 * are the same picture and neither swaps for the other with a visible step.
 *
 * Approximated because it is data: the folder and label counts in the rail, the
 * engine-health card (which only renders when a check is not `active`), and
 * whether the category tab row is showing at all.
 */

/** The shell's own refreshing row, reproduced so both loading states match. */
function ThreadRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-rule-soft px-3 py-3">
      <div className="flex shrink-0 items-center gap-1.5">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="size-4 rounded-full" />
      </div>
      <div className="flex w-48 shrink-0 items-center gap-2">
        <Skeleton className="h-3.5 w-32 rounded" />
      </div>
      <div className="flex min-w-0 flex-1 items-center">
        <Skeleton className="h-3.5 w-4/5 rounded" />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Skeleton className="h-4 w-18 rounded-full" />
      </div>
      <div className="w-28 shrink-0 text-right">
        <Skeleton className="ml-auto h-3 w-12 rounded" />
      </div>
    </div>
  );
}

export default function InboxLoading() {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f6f8fc] text-foreground">
      <main className="flex h-full w-full min-h-0 flex-col py-2 pr-2 sm:pr-4">
        <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden bg-[#f6f8fc] pt-2 font-sans">
          {/* Header: Compose, then the search bar — one line, always */}
          <div className="flex shrink-0 items-center gap-2">
            <div className="w-64 shrink-0 pr-3">
              <div className="px-1">
                <Skeleton className="h-12 w-full rounded-2xl" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <Skeleton className="h-16 w-full rounded-full" />
            </div>
          </div>

          {/* Content row: the folder rail beside the mail surface */}
          <div className="flex min-h-0 flex-1 gap-2">
            <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto pr-3">
              {/* Inbox / Starred / … : `rounded-r-full px-4 py-2` rows */}
              <nav className="space-y-0.5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-8 w-full rounded-r-full" />
                ))}
              </nav>
              {/* The label groups, each with its own heading */}
              {Array.from({ length: 2 }).map((_, groupIndex) => (
                <div key={groupIndex} className="space-y-1 px-3">
                  <Skeleton className="h-3 w-20" />
                  <div className="space-y-0.5 pt-1">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={index} className="h-6 w-full rounded-full" />
                    ))}
                  </div>
                </div>
              ))}
            </aside>

            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-t-panel rounded-b-none bg-white">
                {/* The action bar sits in `p-3` and is a 40px-tall white strip */}
                <div className="p-3">
                  <Skeleton className="h-10 w-full rounded-xl" />
                </div>

                {/* Category tabs, `px-6 py-3` each, over their own hairline */}
                <div className="flex items-center justify-between border-b border-rule-soft px-1">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="flex items-center gap-2.5 px-6 py-3">
                        <Skeleton className="size-4 rounded" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* The thread list */}
                <div className="min-h-0 flex-1 divide-y divide-rule-soft overflow-hidden">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <ThreadRowSkeleton key={index} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
