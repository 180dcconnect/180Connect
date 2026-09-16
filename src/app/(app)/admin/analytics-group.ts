import type { GroupTabsSpec } from "@/components/ui/group-tabs";
import { hasPermission, type AppRole, type Permission } from "@/lib/auth/permissions";

/**
 * The Analytics group: your own numbers and the whole team's numbers as two
 * tabs under one sidebar entry.
 *
 * Same shape as the Data imports and Artificial Intelligence groups
 * (`import-group.ts`, `ai-group.ts`): a static tuple of links, each page
 * rendering the same row with its own route as `current`.
 *
 * Permissions differ between members and the pages keep their own checks. Each
 * tab carries the permission its page enforces, so a CAM's row never offers a
 * tab that would bounce them to the dashboard — Team analytics is admin-only.
 */
export const ANALYTICS_TABS = [
  { href: "/analytics", label: "Your analytics", permission: "client:view" },
  { href: "/admin/analytics", label: "Team analytics", permission: "user:manage" },
] as const satisfies readonly { href: string; label: string; permission: Permission }[];

/** Routes that light up the sidebar's Analytics row. */
export const ANALYTICS_ROUTES: readonly string[] = ANALYTICS_TABS.map((tab) => tab.href);

export function analyticsTabsFor(role: AppRole): GroupTabsSpec {
  return ANALYTICS_TABS.filter((tab) => hasPermission(role, tab.permission));
}
