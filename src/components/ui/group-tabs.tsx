import Link from "next/link";

/** The static tab list a grouped section hands to every member page. */
export type GroupTabsSpec = readonly { href: string; label: string }[];

/**
 * Tab row for a group of sibling admin pages that share one sidebar entry
 * (Data imports, Platform settings). Each page renders the same row with its
 * own route as `current`, so the active tab is correct on a full page
 * navigation — no client state, no shared layout needed.
 *
 * Active styling mirrors the sidebar's selected row (bold on a dark wash) so
 * the group reads as one system with the rail that linked here.
 */
export function GroupTabs({
  tabs,
  current,
  className = "",
}: {
  tabs: GroupTabsSpec;
  /** The tab whose page is being rendered. */
  current: string;
  className?: string;
}) {
  return (
    <nav aria-label="Section" className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {tabs.map((tab) => {
        const active = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              active
                ? "bg-black/[0.08] font-bold text-black"
                : "font-semibold text-black/60 hover:bg-black/[0.05] hover:text-black"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
