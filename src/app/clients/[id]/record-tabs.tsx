"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Liquid } from "liquid-gooey";

/**
 * The record's primary navigation.
 *
 * It replaces a sticky rail of ten `#anchor` links over a single ~6000px page.
 * That rail had the shape of a tab bar without any of the behaviour: no active
 * state, no mobile (`hidden lg:block`), coverage of only ten of sixteen
 * sections, and — because two cards both rendered `id="outreach-heading"` — one
 * link that jumped to the wrong card. Each destination is now a real route, so
 * the browser's own back/forward walk the tabs, a tab survives a refresh, and a
 * link to one section of a client record is a link someone can send.
 *
 * Every tab renders for every role. The role-gated things live *inside* the
 * tabs (compose, suggest-edit), never as a tab that opens onto an empty shell.
 *
 * A segmented pill with one liquid indicator (`liquid-gooey`, `effect="move"`,
 * the tuning from /preview-gooey): the marker trails the tab you picked with a
 * droplet tail instead of cutting to it. The indicator is a single element that
 * translates, not a highlight on each tab — that is what gives `move` something
 * to chase. Every tab is the same width so the offset is `index * TAB_WIDTH`
 * and nothing has to be measured at runtime.
 *
 * `--lead` carries it. The accent is the record's one structural colour, and the
 * tab bar is the most structural thing on the page.
 *
 * The counts come from four `head: true` queries in the shell, so you can tell
 * whether a tab is worth opening before you open it.
 */

const TABS = [
  { segment: "", label: "Overview", count: null },
  { segment: "outreach", label: "Outreach", count: "outreach" },
  { segment: "financials", label: "Financials", count: "financials" },
  { segment: "activity", label: "Activity", count: "activity" },
] as const;

export type TabCounts = { outreach: number; financials: number; activity: number };

/**
 * One width for every tab, so the indicator's position is arithmetic rather than
 * a measurement pass. Wide enough for "Financials" plus a three-digit count.
 */
const TAB_WIDTH = 112;

export function RecordTabs({
  organisationId,
  counts,
}: {
  organisationId: string;
  counts: TabCounts;
}) {
  const pathname = usePathname();
  const base = `/clients/${organisationId}`;

  const hrefFor = (segment: string) => (segment ? `${base}/${segment}` : base);
  const isActive = (segment: string) => {
    const href = hrefFor(segment);
    return segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base;
  };

  // -1 while the route is one the tab bar doesn't own; the indicator hides
  // rather than parking under a tab that isn't open.
  const activeIndex = TABS.findIndex((tab) => isActive(tab.segment));

  return (
    <nav
      aria-label="Sections of this client record"
      className="sticky top-0 z-30 py-2"
    >
      <Liquid
        blur={5}
        contrast={18}
        fill="var(--lead)"
        shadow="0 2px 8px rgba(35, 64, 122, 0.25)"
        className="relative inline-flex max-w-full items-center overflow-x-auto rounded-full border border-lead/10 bg-lead-wash/50 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Liquid.Item effect="move" move={{ springiness: 0.6, trail: 0.5, stretch: 0.25 }}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1 bottom-1 left-1 rounded-full bg-lead transition-[transform,opacity] duration-300"
            style={{
              width: `${TAB_WIDTH}px`,
              transform: `translateX(${Math.max(activeIndex, 0) * TAB_WIDTH}px)`,
              opacity: activeIndex === -1 ? 0 : 1,
            }}
          />
        </Liquid.Item>

        <div className="relative z-10 flex items-center">
          {TABS.map((tab, index) => {
            const active = index === activeIndex;
            const count = tab.count ? counts[tab.count] : null;

            return (
              <Link
                key={tab.segment || "overview"}
                aria-current={active ? "page" : undefined}
                href={hrefFor(tab.segment)}
                style={{ width: `${TAB_WIDTH}px` }}
                className={`flex h-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead-mid ${
                  active ? "text-white" : "text-dim hover:text-ink"
                }`}
              >
                {tab.label}
                {count !== null && count > 0 && (
                  <span
                    className={`ml-1.5 font-mono text-[10.5px] tabular-nums ${
                      active ? "text-white/65" : "text-faint"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </Liquid>
    </nav>
  );
}
