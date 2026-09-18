"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Accessibility } from "@/components/animate-ui/icons/accessibility";
import { User } from "@/components/animate-ui/icons/user";
import { BellRing } from "@/components/animate-ui/icons/bell-ring";
import { Blocks } from "@/components/animate-ui/icons/blocks";
import { ChartColumnIncreasing } from "@/components/animate-ui/icons/chart-column-increasing";
import { ClipboardList } from "@/components/animate-ui/icons/clipboard-list";
import { RefreshCwOff } from "@/components/animate-ui/icons/refresh-cw-off";
import { Clock4 } from "@/components/animate-ui/icons/clock-4";
import { useRef } from "react";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { StampIcon, type StampIconHandle } from "@/components/ui/stamp-icon";
import { SidebarAccountMenu } from "@/components/sidebar-account-menu";

export type SettingsNavItem = {
  href: string;
  label: string;
  description?: string;
};

export type SettingsNavSection = {
  label: string;
  items: SettingsNavItem[];
};

/**
 * Separate component so we can call useRef at the top level (no hooks in map
 * callbacks). The ref lets the Link's row-level hover trigger StampIcon's
 * animation rather than requiring the cursor to be directly over the icon.
 */
function SendingLimitNavItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  const stampRef = useRef<StampIconHandle>(null);
  const linkClasses = `flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm transition-all hover:bg-black/10 ${
    active
      ? "bg-black/12 font-bold text-black"
      : "font-semibold text-black/85 hover:text-black"
  }`;

  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={linkClasses}
        onMouseEnter={() => stampRef.current?.startAnimation()}
        onMouseLeave={() => stampRef.current?.stopAnimation()}
      >
        <StampIcon ref={stampRef} size={16} className="shrink-0 pointer-events-none" aria-hidden />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}

/**
 * The settings area's own rail, which replaces the app sidebar rather than
 * nesting inside it: settings is a place you go *out of* the app into, and a
 * second level of navigation stacked beside the first reads as being lost.
 *
 * Deliberately different from `Sidebar` in three ways, all of them because this
 * rail navigates a handful of pages rather than the whole product:
 *
 *   - No collapse. There is nothing here worth reclaiming 192px for, and a
 *     collapsed state would need icons for rows that are better as words.
 *   - No icons. Six words in two groups do not need glyphs to be scannable,
 *     and inventing one for "Outreach preferences" would be decoration.
 *   - A back button where the app has its logo, so the way out is the first
 *     thing in the tab order, not something to hunt for.
 *
 * The chrome itself — glass, hairline, row shape, active weight — is matched to
 * `Sidebar` on purpose, so crossing into settings reads as the same product in
 * a different room.
 */
export function SettingsSidebar({
  sections,
  backHref,
  userName,
  userEmail,
  roleLabel,
  onLogout,
}: {
  sections: SettingsNavSection[];
  backHref: string;
  userName?: string | null;
  userEmail?: string | null;
  roleLabel: string;
  onLogout: () => Promise<void>;
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 z-20 flex h-screen w-64 shrink-0 flex-col bg-white/55 backdrop-blur-2xl backdrop-saturate-150 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-linear-to-b after:from-white/90 after:via-black/12 after:to-white/50">
      {/* Same 68px as the app rail's logo row, so the two do not shift the
          content area's top edge when you move between them. */}
      <div className="flex h-[68px] shrink-0 items-center px-3.5 py-4">
        <Link
          href={backHref}
          className="group flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm font-bold text-black/85 transition-all hover:bg-black/10 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <ArrowLeft
            className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:-translate-x-0.5"
            strokeWidth={2}
            aria-hidden="true"
          />
          Back to app
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-2 py-2" aria-label="Settings">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-black/40">
              {section.label}
            </p>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = pathname === item.href;
                const iconByHref: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>> = {
                  "/settings/profile": User,
                  "/settings/accessibility": Accessibility,
                  "/settings/notifications": BellRing,
                  "/settings/outreach-preferences": Blocks,
                  "/settings/score-settings": ChartColumnIncreasing,
                  "/settings/data-handling-rules": ClipboardList,
                  "/settings/restricted-fields": RefreshCwOff,
                  "/settings/cycles": Clock4,
                };
                const Icon = iconByHref[item.href];
                const linkClasses = `flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm transition-all hover:bg-black/10 ${
                  active
                    ? "bg-black/12 font-bold text-black"
                    : "font-semibold text-black/85 hover:text-black"
                }`;

                // StampIcon uses a ref to fire on row hover — extracted to
                // SendingLimitNavItem above to satisfy the Rules of Hooks.
                if (item.href === "/settings/sending-limits") {
                  return (
                    <SendingLimitNavItem
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      active={active}
                    />
                  );
                }

                if (Icon) {
                  return (
                    <li key={item.href}>
                      <AnimateIcon animateOnHover asChild>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={linkClasses}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </AnimateIcon>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={linkClasses}
                    >
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* The account block stays: logging out from settings is a normal thing to
          want, and losing it here would be the one place in the signed-in app
          where it is missing. */}
      <div className="border-t border-white/70 p-2">
        <SidebarAccountMenu
          name={userName ?? null}
          email={userEmail ?? null}
          roleLabel={roleLabel}
          collapsed={false}
          onLogout={onLogout}
        />
      </div>
    </aside>
  );
}
