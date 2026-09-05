"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { ChartLine, MessageSquareHeart, ShieldCheck, UserPlus } from "lucide-react";
import { Cctv } from "@/components/animate-ui/icons/cctv";
import { CloudDownload } from "@/components/animate-ui/icons/cloud-download";
import { Compass } from "@/components/animate-ui/icons/compass";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { PanelLeftClose } from "@/components/animate-ui/icons/panel-left-close";
import { PanelLeftOpen } from "@/components/animate-ui/icons/panel-left-open";
import { Users } from "@/components/animate-ui/icons/users";
import { ThumbsUp} from "@/components/animate-ui/icons/thumbs-up";
import UsersGroupIcon from "@/components/ui/users-group-icon";
import { SidebarAccountMenu } from "@/components/sidebar-account-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SidebarChecklist, type SidebarChecklistStep } from "@/components/sidebar-checklist";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/animate-ui/components/radix/tooltip";

export type SidebarOnboarding = {
  steps: SidebarChecklistStep[];
  completedCount: number;
  totalCount: number;
  show?: boolean;
};

export type SidebarIconName = "dashboard" | "admin" | "users" | "add" | "audit" | "import" | "clients" | "feedback" | "analytics";

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
 * Dashboard, clients, team management, audit log, and import status use animated glyphs,
 * which draw their own motion on the row rather than the shared spring below.
 */
const ICONS: Record<SidebarIconName, RailIcon> = {
  dashboard: Compass,
  clients: UsersGroupIcon,
  admin: ShieldCheck,
  users: Users,
  add: UserPlus,
  audit: Cctv,
  import: CloudDownload,
  feedback: ThumbsUp,
  analytics: ChartLine,
};

const MotionLink = motion.create(Link);

/**
 * One spring for every icon in the rail, so a row that nudges and a row that
 * tilts still feel like the same control.
 */
const ICON_SPRING = { type: "spring", stiffness: 420, damping: 17, mass: 0.6 } as const;

/**
 * Hover motion per icon. Each gesture points at what the row *does* — the shield
 * braces — but stays under ~10% scale and ~8 degrees so a rail of them reads
 * as one system rather than a toybox. Triggered from the row, not the glyph, so
 * the whole target responds.
 */
const ICON_MOTION: Partial<Record<SidebarIconName, Variants>> = {
  admin: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.1, rotate: -6 } },
  feedback: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.1, rotate: 6 } },
  // `dashboard`, `clients`, `users`, `audit`, and `import` are deliberately absent:
  // those glyphs animate their own interiors, so a wrapper transform on top would
  // read as two gestures.
};

/**
 * Persistent app sidebar. The caller builds `sections` from `hasPermission`,
 * so a role only ever sees links it can actually open — mirrors the
 * server-side gate on each page rather than replacing it. Collapse state is
 * persisted in localStorage so user preference is remembered across page switches.
 */
export function Sidebar({
  sections,
  userName,
  userEmail,
  roleLabel,
  onLogout,
  initialCollapsed = false,
  onboarding,
}: {
  sections: SidebarSection[];
  userName?: string | null;
  userEmail?: string | null;
  roleLabel: string;
  onLogout: () => Promise<void>;
  initialCollapsed?: boolean;
  onboarding?: SidebarOnboarding;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar_collapsed");
      if (saved !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(saved === "true");
      }
    } catch {
      // Ignore localStorage read error
    }
  }, []);

  const handleToggleCollapse = (nextState: boolean) => {
    setCollapsed(nextState);
    try {
      localStorage.setItem("sidebar_collapsed", String(nextState));
      document.cookie = `sidebar_collapsed=${nextState}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Ignore localStorage write error
    }
  };

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
      {/*
       * One logo button, always the same size and DOM node, whether collapsed
       * or not — swapping to a differently-sized image per state read as two
       * different globes crossfading rather than one shrinking. Row height is
       * pinned to this button's 36px in both states too, so the nav list below
       * doesn't shift when the button on its right appears/disappears.
       */}
      <div className="flex h-[68px] shrink-0 items-center justify-between gap-2.5 px-3.5 py-4">
        <AnimateIcon animateOnHover={!reduceMotion} asChild>
          <button
            type="button"
            onClick={() => collapsed && handleToggleCollapse(false)}
            aria-label={collapsed ? "Expand sidebar" : undefined}
            tabIndex={collapsed ? 0 : -1}
            className={`group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all focus-visible:outline-none ${
              collapsed ? "hover:bg-black/10" : "cursor-default"
            }`}
          >
            <Image
              src="/180dc-globe.png"
              alt="180Connect"
              width={32}
              height={32}
              className={`h-8 w-8 object-contain transition-opacity duration-200 ${
                collapsed ? "group-hover:opacity-0" : ""
              }`}
            />
            {collapsed && (
              <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 text-black">
                <PanelLeftOpen className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
              </span>
            )}
          </button>
        </AnimateIcon>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="min-w-0 flex-1 truncate text-base font-extrabold text-black tracking-tight"
            >
              180Connect
            </motion.span>
          )}
        </AnimatePresence>

        {!collapsed && (
          <AnimateIcon animateOnHover={!reduceMotion} asChild>
            <button
              type="button"
              onClick={() => handleToggleCollapse(true)}
              aria-label="Collapse sidebar"
              className="ml-auto shrink-0 rounded-xl p-1.5 text-black/70 transition-all hover:bg-black/10 hover:text-black focus-visible:outline-none"
            >
              <PanelLeftClose className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </AnimateIcon>
        )}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-2 py-2" aria-label="Primary">
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
                const link = (
                  <AnimateIcon animateOnHover={!reduceMotion} asChild>
                    <MotionLink
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      initial="rest"
                      animate="rest"
                      whileHover="hover"
                      className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm text-black transition-all hover:bg-black/10 ${
                        active ? "bg-black/12 font-bold text-black" : "font-semibold text-black/85 hover:text-black"
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
                );
                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip delayDuration={400}>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent
                          side="right"
                          sideOffset={10}
                          showArrow={false}
                          className="rounded-xl bg-neutral-900 px-3.5 py-2 text-sm font-semibold text-white shadow-lg"
                        >
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {onboarding && (onboarding.show ?? true) && (
        <div className="px-2 pb-2">
          <SidebarChecklist
            steps={onboarding.steps}
            completedCount={onboarding.completedCount}
            totalCount={onboarding.totalCount}
            collapsed={collapsed}
            forceTheme="light"
          />
        </div>
      )}

      <div className="space-y-1 border-t border-white/70 p-2">
        {/* F173: notification bell lives above the account block, inside the
            same footer group — one place every signed-in user already looks. */}
        <NotificationBell collapsed={collapsed} />
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
