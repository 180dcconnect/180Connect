import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { logout } from "@/lib/auth/logout";
import { ShellWash } from "./shell-wash";
import { SettingsSidebar, type SettingsNavSection } from "./settings-sidebar";

/**
 * Chrome for everything under `/settings` — the settings rail plus the content
 * area, in place of the app shell rather than inside it.
 *
 * Like `AppShell` this only checks that *a* session exists, to decide what the
 * rail should list. Each page keeps its own `getCurrentActor` gate for the
 * permission it actually needs.
 */
export async function SettingsShell({ children }: { children: React.ReactNode }) {
  const actorResult = await getCurrentActor();
  if (!actorResult.ok) redirect("/login");
  const actor = actorResult.actor;

  const personal: SettingsNavSection = {
    label: "Personal",
    // Profile is both the view and the edit surface — there is no separate
    // Account row, because it held the same three fields.
    items: [{ href: "/settings/profile", label: "Profile" }],
  };

  // F205 (merged from dev): accessibility applies to every role, so it always
  // has a rail row now that this shell wraps its page too.
  personal.items.push({ href: "/settings/accessibility", label: "Accessibility" });

  // Outreach preferences steer a CAM's own queue, so the row is only shown to
  // someone who can act on that queue — a viewer has no outreach to target.
  if (hasPermission(actor.role, "client:edit")) {
    personal.items.push({
      href: "/settings/outreach-preferences",
      label: "Outreach preferences",
    });
  }

  return (
    <>
      <ShellWash />
      <div className="flex min-h-screen">
        <SettingsSidebar
          sections={[personal]}
          backHref="/dashboard"
          userName={actor.fullName}
          userEmail={actor.email}
          roleLabel={actor.role}
          onLogout={logout}
        />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
