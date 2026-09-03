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
    href: "/clients",
    label: "Clients",
    description: "The active working list. Tap a client to suppress it.",
    permission: "client:view",
  },
  {
    href: "/clients/new",
    label: "Add client manually",
    description: "Submit an organisation that is not available from an API.",
    permission: "client:edit",
  },
  {
    href: "/analytics",
    label: "Your analytics",
    description: "Your own outreach: emails sent, replies, conversions and response time.",
    permission: "client:view",
  },
  {
    href: "/admin",
    label: "Admin workspace",
    description: "Manage users, audit activity and import Companies House data.",
    permission: "user:manage",
  },
  {
    href: "/admin/analytics",
    label: "Team analytics",
    description: "Team-wide outreach performance, conversions over time, and who may need support.",
    permission: "user:manage",
  },
  {
    href: "/admin/cam-settings",
    label: "CAM queue settings",
    description: "Inspect team members' outreach preferences and queue configuration.",
    permission: "user:manage",
  },
  {
    href: "/admin/import-status",
    label: "Import status",
    description: "See whether data ingestion runs succeeded, partially succeeded, or failed.",
    permission: "platform-settings:manage",
  },
  {
    href: "/settings/profile",
    label: "My profile",
    description: "View your name, email, and role.",
  },
  {
    href: "/settings/outreach-preferences",
    label: "Outreach preferences",
    description: "Set the geography, sector and size focus for your queue.",
  },
  {
    href: "/settings/accessibility",
    label: "Accessibility settings",
    description: "Adjust text size, contrast, and visual comfort across the platform.",
  },
];

export function navItemsFor(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(role, item.permission),
  );
}
