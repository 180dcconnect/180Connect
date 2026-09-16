import type { GroupTabsSpec } from "@/components/ui/group-tabs";
import { canView, isViewOnly, type AppRole, type Permission } from "@/lib/auth/permissions";

/**
 * The Actions group: working through your own queue and handing work out as
 * two tabs under one sidebar entry. Your own queue comes first — it is what
 * everyone opens the group for most days.
 *
 * Same shape as the Analytics group (`admin/analytics-group.ts`): a static
 * tuple of links, each page rendering the same row with its own route as
 * `current`.
 *
 * Permissions differ between members and the pages keep their own checks. Each
 * tab carries the permission its page enforces, so a CAM's row never offers a
 * tab that would bounce them to the dashboard — Assign actions is admin-only.
 */
export const ACTIONS_TABS = [
  { href: "/actions", label: "My actions", permission: "client:view" },
  { href: "/admin/actions", label: "Assign actions", permission: "user:manage" },
] as const satisfies readonly { href: string; label: string; permission: Permission }[];

/** Routes that light up the sidebar's Actions row. */
export const ACTIONS_ROUTES: readonly string[] = ACTIONS_TABS.map((tab) => tab.href);

export function actionsTabsFor(role: AppRole): GroupTabsSpec {
  // "My actions" lists actions assigned to you, and nothing is ever assigned to a
  // viewer — leadership gets Assign actions, where the whole team's work is.
  return ACTIONS_TABS.filter(
    (tab) => canView(role, tab.permission) && !(isViewOnly(role) && tab.href === "/actions"),
  );
}
