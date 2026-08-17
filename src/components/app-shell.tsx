import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { logout } from "@/lib/auth/logout";
import { Sidebar, type SidebarSection } from "./sidebar";

/**
 * Shared chrome for every signed-in page: sidebar + content area. Each page
 * keeps its own `getCurrentActor` gate for the permission it actually needs
 * (see admin pages) — this only re-checks that *some* session is present, to
 * decide what the sidebar should show, and bounces to `/login` otherwise.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const actorResult = await getCurrentActor();
  if (!actorResult.ok) redirect("/login");
  const actor = actorResult.actor;

  const sections: SidebarSection[] = [
    {
      items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }],
    },
  ];

  if (hasPermission(actor.role, "client:view")) {
    sections[0].items.push({ href: "/clients", label: "Clients", icon: "users" });
  }

  if (hasPermission(actor.role, "client:edit")) {
    sections[0].items.push({ href: "/clients/new", label: "Add client", icon: "add" });
  }

  if (hasPermission(actor.role, "user:manage")) {
    sections.push({
      label: "Admin",
      items: [
        { href: "/admin", label: "Overview", icon: "admin" },
        { href: "/admin/users", label: "Team management", icon: "users" },
        { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
        { href: "/admin/import-status", label: "Import status", icon: "import" },
      ],
    });
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        sections={sections}
        userLabel={actor.fullName ?? actor.email ?? "Account"}
        roleLabel={actor.role}
        onLogout={logout}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
