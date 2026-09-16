"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type MouseEvent, type Ref } from "react";
import { AnimatePresence, motion, useReducedMotionConfig, type Variants } from "motion/react";
import {
  ChartLine,
  ClipboardCheck,
  ShieldCheck,
  SquareKanban,
  UserPlus,
} from "lucide-react";
import { InboxIcon, type InboxIconHandle } from "@animateicons/react/lucide/inbox-icon";
import { ListChecksIcon, type ListChecksIconHandle } from "@animateicons/react/lucide/list-checks-icon";
import { Cctv } from "@/components/animate-ui/icons/cctv";
import { CloudDownload } from "@/components/animate-ui/icons/cloud-download";
import { Compass } from "@/components/animate-ui/icons/compass";
import { LoaderPinwheel } from "@/components/animate-ui/icons/loader-pinwheel";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { PanelLeftClose } from "@/components/animate-ui/icons/panel-left-close";
import { PanelLeftOpen } from "@/components/animate-ui/icons/panel-left-open";
import { Settings } from "@/components/animate-ui/icons/settings";
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

export type SidebarIconName =
  | "dashboard"
  | "admin"
  | "users"
  | "add"
  | "audit"
  | "import"
  | "clients"
  | "feedback"
  | "inbox"
  | "review"
  | "pipeline"
  | "database"
  | "settings"
  | "actions"
  | "analytics"
  | "ai";

export type SidebarNavItem = {
  href: string;
  label: string;
  icon: SidebarIconName;
  /** Other routes that select this row — a grouped entry's sibling tabs. */
  matches?: readonly string[];
  /**
   * Outstanding-work count shown as a pill beside the label (dot on the icon
   * when collapsed). Omitted — never zero — when there is nothing to show.
   */
  count?: number;
};

export type SidebarSection = {
  label?: string;
  items: SidebarNavItem[];
};

type RailIconProps = {
  className?: string;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
};

type RailIcon = ComponentType<RailIconProps>;

type AnimateIconHandle = { startAnimation: () => void; stopAnimation: () => void };

type AnimateIconComponent<H extends AnimateIconHandle> = ComponentType<
  {
    className?: string;
    size?: number;
    "aria-hidden"?: boolean;
    onMouseEnter?: (event: MouseEvent<HTMLDivElement>) => void;
    onMouseLeave?: (event: MouseEvent<HTMLDivElement>) => void;
    ref?: Ref<H>;
  }
>;

/**
 * @animateicons/react icons don't take strokeWidth, and their built-in
 * hover trigger only fires when no ref is ever attached — but attaching a
 * ref is unavoidable (their own useImperativeHandle sets that internally on
 * mount), so hover has to be driven explicitly via the ref's
 * startAnimation/stopAnimation instead of relying on the icon's own hover
 * handling.
 *
 * Two deliberate choices on top of that:
 *
 * - Row hover, not glyph hover, drives the animation. The rail's convention
 *   is that hovering anywhere on the row animates its icon (every other icon
 *   gets this through the AnimateIcon context the row provides); a 20px glyph
 *   is a much smaller target than its row, so the adapter forwards an
 *   `animationRef` the row's hover handlers can drive.
 * - `size` is pinned to 20 here rather than read off the className: the svg
 *   reads the `size` prop while the className only sizes the wrapper div, so
 *   the default 24 leaked 2px past the 20px box every other glyph keeps.
 */
function withHoverAnimation<H extends AnimateIconHandle>(
  Icon: AnimateIconComponent<H>,
): ComponentType<RailIconProps & { animationRef?: Ref<H> }> {
  return function AnimateIconAdapter({
    strokeWidth: _strokeWidth,
    onMouseEnter,
    onMouseLeave,
    animationRef,
    ...props
  }: {
    className?: string;
    strokeWidth?: number;
    "aria-hidden"?: boolean;
    onMouseEnter?: (event: MouseEvent<HTMLDivElement>) => void;
    onMouseLeave?: (event: MouseEvent<HTMLDivElement>) => void;
    /** Row-level driver: the row calls start/stop on its own hover. */
    animationRef?: Ref<H>;
  }) {
    const innerRef = useRef<H>(null);
    return (
      <Icon
        {...props}
        size={20}
        ref={(handle) => {
          innerRef.current = handle;
          if (typeof animationRef === "function") animationRef(handle);
          else if (animationRef) animationRef.current = handle;
        }}
        onMouseEnter={(event) => {
          onMouseEnter?.(event);
          innerRef.current?.startAnimation();
        }}
        onMouseLeave={(event) => {
          onMouseLeave?.(event);
          innerRef.current?.stopAnimation();
        }}
      />
    );
  };
}

const Inbox = withHoverAnimation<InboxIconHandle>(InboxIcon);
const ListChecks = withHoverAnimation<ListChecksIconHandle>(ListChecksIcon);

/**
 * Nav items name an icon rather than importing one, so the shell stays a plain
 * list of routes and every icon in the rail is drawn on the same grid.
 *
 * Dashboard, clients, team management, audit log, import status, and artificial
 * intelligence use animated glyphs, which draw their own motion on the row
 * rather than the shared spring below.
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
  inbox: Inbox,
  review: ClipboardCheck,
  pipeline: SquareKanban,
  database: CloudDownload,
  settings: Settings,
  actions: ListChecks,
  analytics: ChartLine,
  // The Generate draft pinwheel — the same glyph as the compose modal's AI
  // drafting button. It inherits the row's AnimateIcon hover context, so it
  // spins on row hover like the import icon does. No ICON_MOTION entry: the
  // glyph animates its own interior, so a wrapper transform on top would read
  // as two gestures.
  ai: LoaderPinwheel,
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
  // `dashboard`, `clients`, `users`, `audit`, `import`, `database`, and `ai`
  // are deliberately absent: those glyphs animate their own interiors, so a
  // wrapper transform on top would read as two gestures.
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
  const reduceMotion = useReducedMotionConfig();
  const iconVariants = (variants: Variants | undefined) =>
    reduceMotion ? undefined : variants;

  // Row-hover drivers for the two @animateicons/react glyphs (inbox,
  // actions): unlike every local icon they cannot read the AnimateIcon hover
  // context, so the row starts/stops them imperatively through the refs the
  // adapter forwards. Gated on the same reduceMotion flag as animateOnHover.
  const inboxIconRef = useRef<InboxIconHandle>(null);
  const actionsIconRef = useRef<ListChecksIconHandle>(null);
  const rowIconRef = (icon: SidebarIconName) =>
    icon === "inbox" ? inboxIconRef : icon === "actions" ? actionsIconRef : null;
  const startRowIcon = (icon: SidebarIconName) => {
    if (reduceMotion) return;
    rowIconRef(icon)?.current?.startAnimation();
  };
  const stopRowIcon = (icon: SidebarIconName) => {
    rowIconRef(icon)?.current?.stopAnimation();
  };

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
                const active = pathname === item.href || Boolean(item.matches?.includes(pathname));
                const Icon = ICONS[item.icon];
                const showCount = item.count != null && item.count > 0;
                const link = (
                  <AnimateIcon animateOnHover={!reduceMotion} asChild>
                    <MotionLink
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      initial="rest"
                      animate="rest"
                      whileHover="hover"
                      onHoverStart={() => startRowIcon(item.icon)}
                      onHoverEnd={() => stopRowIcon(item.icon)}
                      className={`relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm text-black transition-all hover:bg-black/10 ${
                        active ? "bg-black/12 font-bold text-black" : "font-semibold text-black/85 hover:text-black"
                      }`}
                    >
                      <motion.span
                        className="flex shrink-0"
                        variants={iconVariants(ICON_MOTION[item.icon])}
                        transition={ICON_SPRING}
                      >
                        {item.icon === "inbox" ? (
                          <Inbox
                            className="h-5 w-5"
                            aria-hidden={true}
                            animationRef={inboxIconRef}
                          />
                        ) : item.icon === "actions" ? (
                          <ListChecks
                            className="h-5 w-5"
                            aria-hidden={true}
                            animationRef={actionsIconRef}
                          />
                        ) : Icon ? (
                          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden={true} />
                        ) : null}
                      </motion.span>
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      )}
                      {showCount && !collapsed && (
                        <span
                          className="shrink-0 rounded-full bg-lead px-2 py-0.5 text-[12px] font-bold tabular-nums text-paper"
                          aria-label={`${item.count} outstanding actions`}
                        >
                          {item.count! > 99 ? "99+" : item.count}
                        </span>
                      )}
                      {showCount && collapsed && (
                        <span
                          className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-lead px-1 text-[10px] font-bold tabular-nums text-paper"
                          aria-label={`${item.count} outstanding actions`}
                        >
                          {item.count! > 99 ? "99+" : item.count}
                        </span>
                      )}
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
