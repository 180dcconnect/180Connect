import type { GroupTabsSpec } from "@/components/ui/group-tabs";
import { canView, type AppRole, type Permission } from "@/lib/auth/permissions";

/**
 * The Artificial Intelligence group: AI generation history, Machine Learning and
 * the email prompt lab as three tabs under one sidebar entry.
 *
 * Same shape as the Data imports group (`import-group.ts`): a static tuple of
 * links, each page rendering the same row with its own route as `current`.
 * All three members are admin-only (`platform-settings:manage`), unlike Data
 * imports (`client:edit`) — the sidebar entry lives in the admin section for
 * that reason. URLs are unchanged (`/admin/ai-generations`,
 * `/admin/ml-readiness`) so existing links keep working.
 *
 * The lab is a viewer tab as well as an admin one: reading the prompt is
 * reading, and a viewer gets the page with the Write button withheld (see
 * `email-lab/page.tsx`).
 */
export const AI_TABS = [
  { href: "/admin/ai-generations", label: "AI generation history", permission: "platform-settings:manage" },
  { href: "/admin/ml-readiness", label: "Machine Learning", permission: "platform-settings:manage" },
  { href: "/admin/email-lab", label: "Email prompt lab", permission: "platform-settings:manage" },
] as const satisfies readonly { href: string; label: string; permission: Permission }[];

/** Routes that light up the sidebar's Artificial Intelligence row. */
export const AI_ROUTES: readonly string[] = AI_TABS.map((tab) => tab.href);

export function aiTabsFor(role: AppRole): GroupTabsSpec {
  return AI_TABS.filter((tab) => canView(role, tab.permission));
}
