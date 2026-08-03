import { hasPermission, type AppRole, type Permission } from "./auth/permissions.ts";

/**
 * The one list of destinations a signed-in user can be sent to.
 *
 * Only routes that exist belong here. A tile for a feature that has not been
 * built yet is worse than no tile: the user spends a click finding out, and the
 * dashboard stops being a reliable map of the product. When a feature ships, add
 * its route here with the permission it already enforces server-side — the nav
 * then follows automatically for every role, and the page keeps its own check.
 */
export type NavItem = {
  href: string;
  label: string;
  description: string;
  permission: Permission;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/admin/users",
    label: "Team management",
    description: "Assign roles and suspend or reactivate access.",
    permission: "user:manage",
  },
];

export function navItemsFor(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter((item) => hasPermission(role, item.permission));
}
