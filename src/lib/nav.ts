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
  // Omit for a destination every signed-in role can reach (e.g. viewing your
  // own profile) — there's no permission that means "everyone".
  permission?: Permission;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/admin",
    label: "Admin workspace",
    description: "Manage users, audit activity and import Companies House data.",
    permission: "user:manage",
  },
  {
    href: "/profile",
    label: "My profile",
    description: "View your name, email, and role.",
  },
];

export function navItemsFor(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(role, item.permission),
  );
}
