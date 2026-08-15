"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { ArrowDownToLine, PanelLeftClose, PanelLeftOpen, ScrollText, ShieldCheck } from "lucide-react";
import { Compass } from "@/components/animate-ui/icons/compass";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { Users } from "@/components/animate-ui/icons/users";
import { SidebarAccountMenu } from "@/components/sidebar-account-menu";

export type SidebarIconName = "dashboard" | "admin" | "users" | "audit" | "import";

export type SidebarNavItem = {
  href: string;
  label: string;
  icon: SidebarIconName;
};

export type SidebarSection = {
  label?: string;
  items: SidebarNavItem[];
};

type RailIcon = ComponentType<{
  className?: string;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
}>;

/**
 * Nav items name an icon rather than importing one, so the shell stays a plain
 * list of routes and every icon in the rail is drawn on the same grid.
 *
 * Dashboard and team management use animate-ui glyphs, which draw their own
 * motion from the `AnimateIcon` context on the row rather than the shared
 * spring below.
 */
const ICONS: Record<SidebarIconName, RailIcon> = {
  dashboard: Compass,
  admin: ShieldCheck,
  users: Users,
  audit: ScrollText,
  import: ArrowDownToLine,
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
const ICON_MOTION: Partial<Record<SidebarIconName, Variants>> = {
  admin: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.1, rotate: -6 } },
  audit: { rest: { rotate: 0, y: 0 }, hover: { rotate: -8, y: -1 } },
  import: { rest: { y: 0 }, hover: { y: 2 } },
  // `dashboard` and `users` are deliberately absent: those animate-ui glyphs
  // animate their own interiors, so a wrapper transform on top would read as
  // two gestures.
};

const TOGGLE_MOTION: Variants = { rest: { x: 0 }, hover: { x: -2 } };

/**
 * Persistent app sidebar. The caller builds `sections` from `hasPermission`,
 * so a role only ever sees links it can actually open — mirrors the
 * server-side gate on each page rather than replacing it. Collapse state is
 * local and UI-only; it does not gate anything.
 */
export function Sidebar({
  sections,
  userName,
  userEmail,
  roleLabel,
  onLogout,
}: {
  sections: SidebarSection[];
  userName?: string | null;
  userEmail?: string | null;
  roleLabel: string;
  onLogout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // Someone who asked the OS for less motion gets the colour change only.
  const reduceMotion = useReducedMotion();
  const iconVariants = (variants: Variants | undefined) =>
    reduceMotion ? undefined : variants;

  return (
    <aside
      className={`sticky top-0 z-20 flex h-screen shrink-0 flex-col bg-white/55 backdrop-blur-2xl backdrop-saturate-150 transition-[width] duration-200 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-linear-to-b after:from-white/90 after:via-black/12 after:to-white/50 ${
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
          className="ml-auto shrink-0 rounded-lg p-1.5 text-black/60 transition-colors hover:bg-white/55 hover:text-black"
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
                    <AnimateIcon animateOnHover={!reduceMotion} asChild>
                      <MotionLink
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        aria-current={active ? "page" : undefined}
                        initial="rest"
                        animate="rest"
                        whileHover="hover"
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-black transition-colors hover:bg-white/55 ${
                          active ? "bg-white/75 font-bold shadow-xs" : "font-medium"
                        }`}
                      >
                        <motion.span
                          className="flex shrink-0"
                          variants={iconVariants(ICON_MOTION[item.icon])}
                          transition={ICON_SPRING}
                        >
                          {Icon ? <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden={true} /> : null}
                        </motion.span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </MotionLink>
                    </AnimateIcon>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/70 p-2">
        <SidebarAccountMenu
          name={userName ?? null}
          email={userEmail ?? null}
          roleLabel={roleLabel}
          collapsed={collapsed}
          onLogout={onLogout}
        />
      </div>
    </aside>
  );
}
