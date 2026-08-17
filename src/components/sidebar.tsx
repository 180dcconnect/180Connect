"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";

export type SidebarIconName = "dashboard" | "admin" | "users" | "add" | "audit" | "import";

export type SidebarNavItem = {
  href: string;
  label: string;
  icon: SidebarIconName;
};

export type SidebarSection = {
  label?: string;
  items: SidebarNavItem[];
};

const ICONS: Record<SidebarIconName, ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <rect x="3" y="3" width="6" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="3" width="6" height="4" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="9" width="6" height="8" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="12" width="6" height="5" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M10 2.5 4 5v4.5c0 4.14 2.7 7.6 6 8.5 3.3-.9 6-4.36 6-8.5V5l-6-2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <circle cx="7.25" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 16c.5-3 2.3-4.5 4.75-4.5S11.5 13 12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 11.2c1.9.1 3.3 1.5 3.7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  add: (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.5v7M6.5 10h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <rect x="4" y="2.5" width="12" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7h6M7 10h6M7 13h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  import: (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M10 3v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6.5 8.5 10 12l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 14v1.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d={collapsed ? "M7.5 4.5 12.5 10l-5 5.5" : "M12.5 4.5 7.5 10l5 5.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M8 17H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 13.5 17 10l-4-3.5M17 10H7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Persistent app sidebar. The caller builds `sections` from `hasPermission`,
 * so a role only ever sees links it can actually open — mirrors the
 * server-side gate on each page rather than replacing it. Collapse state is
 * local and UI-only; it does not gate anything.
 */
export function Sidebar({
  sections,
  userLabel,
  roleLabel,
  onLogout,
}: {
  sections: SidebarSection[];
  userLabel: string;
  roleLabel: string;
  onLogout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-black/10 bg-white transition-[width] duration-200 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-4">
        {!collapsed && (
          <span className="truncate px-1 text-sm font-bold text-brand">180Connect</span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="ml-auto shrink-0 rounded-lg p-1.5 text-foreground/50 hover:bg-black/5 hover:text-foreground"
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-2 py-2" aria-label="Primary">
        {sections.map((section, index) => (
          <div key={section.label ?? index}>
            {section.label && !collapsed && (
              <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-foreground/40">
                {section.label}
              </p>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-brand/10 text-brand"
                          : "text-foreground/70 hover:bg-black/5 hover:text-foreground"
                      }`}
                    >
                      <span className="shrink-0">{ICONS[item.icon]}</span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-black/10 p-2">
        {!collapsed && (
          <div className="mb-1 px-2 pt-2">
            <p className="truncate text-sm font-bold">{userLabel}</p>
            <p className="text-xs font-bold uppercase tracking-wide text-foreground/45">
              {roleLabel}
            </p>
          </div>
        )}
        <form action={onLogout}>
          <button
            type="submit"
            title={collapsed ? "Log out" : undefined}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-bold text-foreground/70 hover:bg-black/5 hover:text-foreground"
          >
            <LogoutIcon />
            {!collapsed && <span>Log out</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}
