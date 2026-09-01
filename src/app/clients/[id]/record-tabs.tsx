"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
 */

const TABS = [
  { segment: "", label: "Overview" },
  { segment: "outreach", label: "Outreach" },
  { segment: "financials", label: "Financials" },
  { segment: "activity", label: "Activity" },
] as const;

export function RecordTabs({ organisationId }: { organisationId: string }) {
  const pathname = usePathname();
  const base = `/clients/${organisationId}`;

  return (
    /* The bone wash and negative gutters matter: the bar pins to the top of the
       viewport, and without a ground of its own the page's cards would scroll
       visibly through the gap above and below the pill. */
    <nav
      aria-label="Sections of this client record"
      className="sticky top-0 z-40 -mx-6 bg-[#f4f4ef]/85 px-6 py-2 backdrop-blur-sm sm:-mx-10 sm:px-10"
    >
      <div className="flex overflow-x-auto rounded-full bg-white/80 p-1 shadow-sm ring-1 ring-black/[0.06] backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const active = tab.segment
            ? pathname === href || pathname.startsWith(`${href}/`)
            : pathname === base;

          return (
            <Link
              key={tab.segment || "overview"}
              aria-current={active ? "page" : undefined}
              className={`grow shrink-0 rounded-full px-4 py-2 text-center text-[11px] font-bold tracking-[0.08em] whitespace-nowrap uppercase transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
                active
                  ? "bg-[#1c1a18] text-[#f4f4ef] shadow-sm"
                  : "text-foreground/50 hover:bg-black/[0.04] hover:text-foreground/80"
              }`}
              href={href}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
