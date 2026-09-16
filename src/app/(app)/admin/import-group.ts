import type { GroupTabsSpec } from "@/components/ui/group-tabs";
import { canView, isViewOnly, type AppRole, type Permission } from "@/lib/auth/permissions";

/**
 * The group that earns one sidebar entry because no single member is visited
 * often enough alone, but the family is navigated as one.
 *
 * `tabs` is a static tuple of links — the pages render the same row with their
 * own route as `current`, so the active tab is right on every full navigation.
 *
 * "Add a client" sits beside Import status even though it lives at
 * `/clients/new`: adding one organisation by hand and importing a register are
 * the same job with a different starting point, and the URL stays where every
 * existing link (the Clients page button, the inbox composer, drafts) expects it.
 *
 * Permissions differ between members and the pages keep their own checks. Each
 * tab carries the permission its page enforces, so a CAM's row never offers a
 * tab that would bounce them to the dashboard — 360Giving is admin-only.
 *
 * Leadership is the one member of the family whose tabs are not decided by
 * permission alone, because a viewer passes every `canView`. The register tabs
 * are pages to read as well as places to work, so they stay; "Add a client" is
 * a form and nothing else, and offering it to someone who cannot submit it is
 * offering them a dead end.
 */
export const DATA_IMPORTS_TABS = [
  { href: "/admin/import-status", label: "Import status", permission: "client:edit" },
  { href: "/clients/new", label: "Add a client", permission: "client:edit" },
  // Hidden from leadership in `dataImportsTabsFor` — a viewer is never offered
  // it, because the page is a form they would be refused at the end of.
  { href: "/admin/companies-house", label: "Companies House", permission: "client:edit" },
  { href: "/admin/charity-commission", label: "Charity Commission", permission: "client:edit" },
  { href: "/admin/three-sixty-giving", label: "360Giving", permission: "user:manage" },
] as const satisfies readonly { href: string; label: string; permission: Permission }[];

/** Routes that light up the sidebar's Data imports row. */
export const DATA_IMPORTS_ROUTES: readonly string[] = DATA_IMPORTS_TABS.map((tab) => tab.href);

export function dataImportsTabsFor(role: AppRole): GroupTabsSpec {
  return DATA_IMPORTS_TABS.filter(
    (tab) =>
      canView(role, tab.permission) && !(isViewOnly(role) && tab.href === "/clients/new"),
  );
}
