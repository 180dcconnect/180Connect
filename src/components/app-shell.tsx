import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { logout } from "@/lib/auth/logout";
import { AppShellFrame } from "./app-shell-frame";
import type { SidebarSection } from "./sidebar";

/**
 * What the sidebar's frosted glass actually blurs: brand green, pooled at the
 * top-left where the navigation sits and lifted again along the bottom under
 * the account block, so the rail is brightest exactly where it is busiest.
 *
 * Both layers stay in green. The dark `--brand-hover` was tried here and is
 * too desaturated to survive a 40px blur — it lands as grey dirt rather than
 * depth. Neither fades to `transparent` either: that keyword is rgba(0,0,0,0),
 * so the ramp would run through grey for the same reason.
 *
 * The lower layer is linear, not a second ellipse — an ellipse's edge is still
 * legible through the blur at this scale, and read as a rendering fault.
 * The mask retires the panel's own right edge, so no boundary can show
 * whatever a page puts beside it or however wide the rail is collapsed to.
 */
function ShellWash() {
  const fadeOutRight = "linear-gradient(to right, #000 55%, rgba(0, 0, 0, 0) 100%)";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-y-0 left-0 -z-10 w-[420px]"
      style={{
        background: [
          "radial-gradient(85% 55% at 0% 0%, rgba(114, 183, 68, 0.45), rgba(114, 183, 68, 0) 72%)",
          "linear-gradient(to bottom, rgba(114, 183, 68, 0) 22%, rgba(114, 183, 68, 0.26) 100%)",
        ].join(", "),
        WebkitMaskImage: fadeOutRight,
        maskImage: fadeOutRight,
      }}
    />
  );
}

/**
 * Shared chrome for every signed-in page: sidebar + content area. Each page
 * keeps its own `getCurrentActor` gate for the permission it actually needs
 * (see admin pages) — this only re-checks that *some* session is present, to
 * decide what the sidebar should show, and bounces to `/login` otherwise.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get("sidebar_collapsed")?.value === "true";
  const actorResult = await getCurrentActor();
  if (!actorResult.ok) redirect("/login");
  const actor = actorResult.actor;

  const sections: SidebarSection[] = [
    {
      items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }],
    },
  ];

  if (hasPermission(actor.role, "client:view")) {
    sections[0].items.push({ href: "/clients", label: "Clients", icon: "clients" });
  }

  if (hasPermission(actor.role, "user:manage")) {
    sections.push({
      items: [
        { href: "/admin", label: "Overview", icon: "admin" },
        { href: "/admin/users", label: "Team management", icon: "users" },
        { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
        { href: "/admin/import-status", label: "Import status", icon: "import" },
        { href: "/admin/tags", label: "Tags", icon: "users" },
      ],
    });
  }

  return (
    <>
      <ShellWash />
      <AppShellFrame
        sections={sections}
        userName={actor.fullName}
        userEmail={actor.email}
        roleLabel={actor.role}
        onLogout={logout}
        initialCollapsed={initialCollapsed}
      >
        {children}
      </AppShellFrame>
    </>
  );
}
