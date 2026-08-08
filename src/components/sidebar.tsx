"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";

export type SidebarIconName = "dashboard" | "admin" | "users" | "audit";

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
  audit: (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <rect x="4" y="2.5" width="12" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7h6M7 10h6M7 13h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

function UserIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <circle cx="10" cy="6.5" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 16.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M8 17H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 13.5 17 10l-4-3.5M17 10H7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Persistent app bottom dock navigation. The caller builds `sections` from `hasPermission`,
 * so a role only ever sees links it can actually open.
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
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-[#2d2825]/90 p-2.5 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] text-white"
    >
      {sections.map((section, sIndex) => (
        <div key={section.label ?? sIndex} className="flex items-center gap-1">
          {sIndex > 0 && <div className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />}
          {section.items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-2.5 rounded-xl px-4.5 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  active
                    ? "bg-[#1c1a18] text-white ring-1 ring-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_8px_20px_rgba(0,0,0,0.7)]"
                    : "text-white/70 hover:text-white hover:bg-[#1c1a18] hover:ring-1 hover:ring-white/15 hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_8px_20px_rgba(0,0,0,0.7)]"
                }`}
              >
                <span className="shrink-0">{ICONS[item.icon]}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}

      {/* Profile & Dropdown menu */}
      <div className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />

      <div className="relative">
        {profileOpen && (
          <>
            {/* Backdrop overlay to close menu */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setProfileOpen(false)}
              aria-hidden="true"
            />
            {/* Floating Menu above dock */}
            <div className="absolute bottom-full right-0 mb-3 w-56 z-50 rounded-2xl border border-white/10 bg-[#24201e]/95 p-2 backdrop-blur-xl shadow-[0_20px_40px_rgba(0,0,0,0.6)] text-white">
              <div className="px-3 py-2 border-b border-white/10">
                <p className="truncate text-sm font-bold text-white">{userLabel}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/50 mt-0.5">
                  {roleLabel}
                </p>
              </div>
              <div className="pt-1.5">
                <form action={onLogout}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                  >
                    <LogoutIcon />
                    <span>Log out</span>
                  </button>
                </form>
              </div>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={() => setProfileOpen((prev) => !prev)}
          title={userLabel}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
            profileOpen
              ? "bg-[#1c1a18] text-white ring-1 ring-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_8px_20px_rgba(0,0,0,0.7)]"
              : "text-white/70 hover:text-white hover:bg-[#1c1a18] hover:ring-1 hover:ring-white/15 hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_8px_20px_rgba(0,0,0,0.7)]"
          }`}
        >
          <UserIcon />
          <span className="hidden sm:inline">Profile</span>
        </button>
      </div>
    </nav>
  );
}
