import { hasPermission, type AppRole, type Permission } from "./auth/permissions.ts";
import type { SidebarIconName } from "@/components/sidebar";

/**
 * The one list of destinations the sidebar can show. `AppShell` turns this
 * into `SidebarSection[]` by filtering on the signed-in role — there is no
 * second, hand-maintained copy of the nav to drift out of sync with this one.
 *
 * A route that exists gets a real link. A route that doesn't yet exist gets
 * `plannedFeatureId` instead of working navigation: the sidebar still shows
 * the destination (it's part of the platform's map, per the sidebar's own
 * user story), but clicking it opens a "not built yet" dialog rather than a
 * 404. Every `plannedFeatureId` must have a matching
 * `docs/unfinished-work/<slug>.md` — `nav.test.ts` checks both directions,
 * so a shipped route with a stale doc, or a doc with no matching entry,
 * fails the build. Delete the doc and drop `plannedFeatureId` the day the
 * route ships.
 */
export type SidebarNavEntry = {
  href: string;
  label: string;
  icon: SidebarIconName;
  // Omit for a destination every signed-in role can reach — there's no
  // permission that means "everyone".
  permission?: Permission;
  // Set when `href` doesn't exist yet. See docs/unfinished-work/README.md.
  plannedFeatureId?: string;
};

export type SidebarNavSection = {
  label?: string;
  items: SidebarNavEntry[];
};

export const SIDEBAR_SECTIONS: readonly SidebarNavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/clients", label: "Clients", icon: "clients", permission: "client:view" },
      { href: "/actions", label: "Actions", icon: "actions", plannedFeatureId: "F168" },
    ],
  },
  {
    // Kept even though it's a thin, somewhat redundant hub next to the items
    // below — Bashir wants it removed later, not in this pass.
    label: "Admin",
    items: [{ href: "/admin", label: "Overview", icon: "admin", permission: "user:manage" }],
  },
  {
    label: "Data quality",
    items: [
      { href: "/admin/review", label: "Review queue", icon: "review", permission: "user:manage" },
      { href: "/admin/duplicates", label: "Duplicates", icon: "duplicates", permission: "approval:manage" },
      {
        href: "/admin/suppressions",
        label: "Suppressions",
        icon: "suppressions",
        permission: "approval:manage",
      },
    ],
  },
  {
    label: "Data imports",
    items: [
      {
        href: "/admin/companies-house",
        label: "Companies House",
        icon: "companies-house",
        permission: "user:manage",
      },
      {
        href: "/admin/charity-commission",
        label: "Charity Commission",
        icon: "charity-commission",
        permission: "user:manage",
      },
      {
        href: "/admin/three-sixty-giving",
        label: "360Giving",
        icon: "three-sixty-giving",
        permission: "user:manage",
      },
      {
        href: "/admin/import-status",
        label: "Import status",
        icon: "import",
        permission: "platform-settings:manage",
      },
      { href: "/admin/users", label: "Team management", icon: "users", permission: "user:manage" },
      { href: "/admin/audit-log", label: "Audit log", icon: "audit", permission: "user:manage" },
    ],
  },
];

export function sidebarSectionsFor(role: AppRole): SidebarNavSection[] {
  return SIDEBAR_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || hasPermission(role, item.permission)),
  })).filter((section) => section.items.length > 0);
}
