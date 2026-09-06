import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { AppShellFrame } from "@/components/app-shell-frame";
import { ShellWash } from "@/components/shell-wash";
import type { SidebarSection } from "@/components/sidebar";
import { getCurrentActor } from "@/lib/auth/actor";
import { logout } from "@/lib/auth/logout";

/**
 * Layout for /preview-inbox.
 * Renders the persistent application sidebar (Dashboard, Clients, Inbox, Admin...).
 * If the user has an active session, uses the real AppShell with their role & permissions.
 * Otherwise, falls back to a preview app shell frame so the preview remains accessible without auth.
 */
export default async function PreviewInboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actorResult = await getCurrentActor();
  if (actorResult.ok) {
    return <AppShell>{children}</AppShell>;
  }

  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get("sidebar_collapsed")?.value === "true";

  const previewSections: SidebarSection[] = [
    {
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
        { href: "/clients", label: "Clients", icon: "clients" },
        { href: "/inbox", label: "Inbox", icon: "inbox" },
        { href: "/clients/new", label: "Add client", icon: "add" },
      ],
    },
    {
      items: [
        { href: "/admin", label: "Overview", icon: "admin" },
        { href: "/admin/users", label: "Team management", icon: "users" },
        { href: "/admin/review", label: "Review queue", icon: "review" },
        { href: "/admin/team-pipeline", label: "Team pipeline", icon: "pipeline" },
        { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
        { href: "/admin/import-status", label: "Data imports", icon: "import" },
        { href: "/admin/feedback", label: "Feedback", icon: "feedback" },
      ],
    },
  ];

  return (
    <>
      <ShellWash />
      <AppShellFrame
        sections={previewSections}
        userName="Ada Lovelace"
        userEmail="ada.lovelace@180dc.org"
        roleLabel="cam"
        onLogout={logout}
        initialCollapsed={initialCollapsed}
      >
        {children}
      </AppShellFrame>
    </>
  );
}
