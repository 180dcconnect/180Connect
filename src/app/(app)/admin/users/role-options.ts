/**
 * The three invitable roles, as the invite sheet presents them.
 *
 * Its own module because it used to live in `invite-sheet.tsx` and be imported
 * across from `invite-sheet-dark.tsx` — so deleting the dead light sheet would
 * have taken the live sheet's role list with it. `public.user_role` is the
 * authority on the values (20260722103000_create_users.sql); the copy here is
 * presentation only.
 */

export const ROLE_OPTIONS = [
  {
    value: "cam" as const,
    title: "CAM (Client Acquisition Manager)",
    badge: "Outreach & Pipeline",
    badgeStyle:
      "bg-emerald-500/20 text-emerald-300",
    description:
      "For team members running outreach campaigns, claiming and managing client pipelines, drafting emails, and logging notes.",
  },
  {
    value: "admin" as const,
    title: "Administrator",
    badge: "Full Access",
    badgeStyle:
      "bg-purple-500/20 text-purple-300",
    description:
      "Full administrative access to manage members, user roles, data imports, and system settings — includes all CAM client outreach and pipeline management capabilities.",
  },
  {
    value: "viewer" as const,
    title: "Viewer",
    badge: "Read-only",
    badgeStyle:
      "bg-sky-500/20 text-sky-300",
    description:
      "For stakeholders and observers who need read-only access to browse clients, metrics, and team activity without making changes.",
  },
] as const;
