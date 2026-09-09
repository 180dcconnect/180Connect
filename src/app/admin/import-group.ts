import type { GroupTabsSpec } from "@/components/ui/group-tabs";

/**
 * The admin group that earns one sidebar entry because no single member is
 * visited often enough alone, but the family is navigated as one.
 *
 * `tabs` is a static tuple of links — the pages render the same row with their
 * own route as `current`, so the active tab is right on every full navigation.
 *
 * Permissions deliberately differ between members (import-status gates on
 * platform-settings:manage; the three importers on user:manage) and the pages
 * keep their own checks. The sidebar entry shows for admins, the only role
 * that reaches every member.
 */
export const DATA_IMPORTS_TABS: GroupTabsSpec = [
  { href: "/admin/import-status", label: "Import status" },
  { href: "/admin/companies-house", label: "Companies House" },
  { href: "/admin/charity-commission", label: "Charity Commission" },
  { href: "/admin/three-sixty-giving", label: "360Giving" },
] as const;
