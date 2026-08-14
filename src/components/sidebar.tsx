"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import {
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

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

/**
 * Nav items name an icon rather than importing one, so the shell stays a plain
 * list of routes and every icon in the rail is drawn on the same grid.
 */
const ICONS: Record<SidebarIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  admin: ShieldCheck,
  users: Users,
  audit: ScrollText,
};

const MotionLink = motion.create(Link);

/**
 * One spring for every icon in the rail, so a row that nudges and a row that
 * tilts still feel like the same control.
 */
const ICON_SPRING = { type: "spring", stiffness: 420, damping: 17, mass: 0.6 } as const;

/**
 * Hover motion per icon. Each gesture points at what the row *does* — the shield
 * braces, the log tilts like a page being read — but stays under ~10% scale and
 * ~8 degrees so a rail of them reads as one system rather than a toybox.
 * Triggered from the row, not the glyph, so the whole target responds.
 */
const ICON_MOTION: Record<SidebarIconName, Variants> = {
  dashboard: { rest: { scale: 1 }, hover: { scale: 1.12 } },
  admin: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.1, rotate: -6 } },
  users: { rest: { scale: 1, x: 0 }, hover: { scale: 1.08, x: 1.5 } },
  audit: { rest: { rotate: 0, y: 0 }, hover: { rotate: -8, y: -1 } },
};

const LOGOUT_MOTION: Variants = { rest: { x: 0 }, hover: { x: 3 } };
const TOGGLE_MOTION: Variants = { rest: { x: 0 }, hover: { x: -2 } };

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
  // Someone who asked the OS for less motion gets the colour change only.
  const reduceMotion = useReducedMotion();
  const iconVariants = (variants: Variants) => (reduceMotion ? undefined : variants);

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-black/10 bg-white transition-[width] duration-200 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-4">
        {!collapsed && (
          <span className="truncate px-1 text-sm font-bold text-black">180Connect</span>
        )}
        <motion.button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          initial="rest"
          animate="rest"
          whileHover="hover"
          className="ml-auto shrink-0 rounded-lg p-1.5 text-black/60 transition-colors hover:bg-black/10 hover:text-black"
        >
          <motion.span
            className="flex"
            variants={iconVariants(TOGGLE_MOTION)}
            transition={ICON_SPRING}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden="true" />
            )}
          </motion.span>
        </motion.button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-2 py-2" aria-label="Primary">
        {sections.map((section, index) => (
          <div key={section.label ?? index}>
            {section.label && !collapsed && (
              <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-black/40">
                {section.label}
              </p>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = pathname === item.href;
                const Icon = ICONS[item.icon];
                return (
                  <li key={item.href}>
                    <MotionLink
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      initial="rest"
                      animate="rest"
                      whileHover="hover"
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-black transition-colors hover:bg-black/10 ${
                        active ? "bg-black/10 font-bold" : "font-medium"
                      }`}
                    >
                      <motion.span
                        className="flex shrink-0"
                        variants={iconVariants(ICON_MOTION[item.icon])}
                        transition={ICON_SPRING}
                      >
                        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                      </motion.span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </MotionLink>
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
            <p className="truncate text-sm font-bold text-black">{userLabel}</p>
            <p className="text-xs font-bold uppercase tracking-wide text-black/45">{roleLabel}</p>
          </div>
        )}
        <form action={onLogout}>
          <motion.button
            type="submit"
            title={collapsed ? "Log out" : undefined}
            initial="rest"
            animate="rest"
            whileHover="hover"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-bold text-black transition-colors hover:bg-black/10"
          >
            <motion.span
              className="flex shrink-0"
              variants={iconVariants(LOGOUT_MOTION)}
              transition={ICON_SPRING}
            >
              <LogOut className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </motion.span>
            {!collapsed && <span>Log out</span>}
          </motion.button>
        </form>
      </div>
    </aside>
  );
}
