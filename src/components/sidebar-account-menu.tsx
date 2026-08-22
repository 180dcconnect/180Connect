"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, CircleUserRound, LogOut, Sliders } from "lucide-react";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { Settings } from "@/components/animate-ui/icons/settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";

/**
 * Initials for the avatar: first name + last name, which is what a reader
 * recognises themselves by. Falls back through the single-word name to the
 * email, so the circle is never empty for an account with no profile name.
 */
function initialsOf(name: string | null, email: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (email ?? "?").slice(0, 1).toUpperCase();
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-xs font-bold tracking-wide text-brand-hover"
    >
      {initials}
    </span>
  );
}

/**
 * The rail's account block. The row itself carries name and role — the two
 * things that decide what the rest of the sidebar shows — and holds the email
 * back for the menu, where someone checking *which* account they are signed
 * into is the reason they opened it.
 *
 * Radix owns the open/close behaviour, focus and keyboard handling; animate-ui
 * adds the entry animation and the highlight that slides between items.
 */
export function SidebarAccountMenu({
  name,
  email,
  roleLabel,
  collapsed,
  onLogout,
}: {
  name: string | null;
  email: string | null;
  roleLabel: string;
  collapsed: boolean;
  onLogout: () => Promise<void>;
}) {
  const router = useRouter();
  const displayName = name ?? email ?? "Account";
  const initials = initialsOf(name, email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={collapsed ? displayName : undefined}
          className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-all hover:bg-black/10 data-[state=open]:bg-black/12 md:pl-1.5 ${
            collapsed ? "md:pr-1.5" : ""
          }`}
        >
          <Avatar initials={initials} />
          {/* Hidden by class rather than unmounted: `collapsed` is a desktop-only
              state (see Sidebar), and below `md` this block always shows. */}
          <span className={`min-w-0 flex-1 ${collapsed ? "md:hidden" : ""}`}>
            <span className="block truncate text-sm font-bold text-black">{displayName}</span>
            <span className="block truncate text-xs font-bold uppercase tracking-wide text-black/45">
              {roleLabel}
            </span>
          </span>
          <ChevronsUpDown
            className={`size-4 shrink-0 text-black/40 ${collapsed ? "md:hidden" : ""}`}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>

      {/*
       * Opens upward: the block sits at the foot of the rail. `border-black/10`
       * is explicit because the component's own `border` utility resolves to
       * currentColor — shadcn normally fixes that with a global `*` border rule,
       * which would restyle every border in the app.
       */}
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-60 border-black/10 bg-white/85 backdrop-blur-xl"
      >
        <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2 font-normal">
          <Avatar initials={initials} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-black">{displayName}</span>
            {email && <span className="block truncate text-xs text-black/55">{email}</span>}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/*
         * `onSelect` rather than a nested link or submit button: animate-ui's
         * item spends Radix's `asChild` on its own `motion.div` and drops the
         * prop, so an item cannot *be* an anchor. `logout` redirects, so
         * calling the action directly ends the same way the form post did.
         */}
        <DropdownMenuItem onSelect={() => router.push("/settings/profile")}>
          <CircleUserRound aria-hidden="true" />
          Profile
        </DropdownMenuItem>

        <AnimateIcon animateOnHover asChild>
          <DropdownMenuItem onSelect={() => router.push("/settings")}>
            <Settings aria-hidden="true" />
            Settings
          </DropdownMenuItem>
        </AnimateIcon>

        <DropdownMenuItem onSelect={() => router.push("/settings/accessibility")}>
          <Sliders aria-hidden="true" />
          Accessibility
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => void onLogout()}>
          <LogOut aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
