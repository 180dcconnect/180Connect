import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { canView, isViewOnly } from "@/lib/auth/permissions";
import { logout } from "@/lib/auth/logout";
import { ShellWash } from "./shell-wash";
import { SkipLink } from "./skip-link";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { AccessibilityAccountSync } from "./accessibility-account-sync";
import { ViewOnlyNotice } from "./view-only-notice";
import { SettingsSidebar, type SettingsNavSection } from "./settings-sidebar";

/**
 * Chrome for everything under `/settings` — the settings rail plus the content
 * area, in place of the app shell rather than inside it.
 *
 * Like `AppShell` this only checks that *a* session exists, to decide what the
 * rail should list. Each page keeps its own `getViewingActor` gate for the
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

  // F178: every role receives notifications (matrix §3.19 is shared across
  // all active roles), so this row is unconditional too, same as Accessibility.
  personal.items.push({ href: "/settings/notifications", label: "Notifications" });

  // Outreach preferences steer a CAM's own queue. Shown to viewers too, who see
  // every screen an admin does and are refused only when they save.
  if (canView(actor.role, "client:edit")) {
    personal.items.push({
      href: "/settings/outreach-preferences",
      label: "Outreach preferences",
    });
  }

  // Platform configuration — score weights, data handling rules, restricted
  // fields. Moved out of the app sidebar: it is settings, not a daily-ops
  // destination. Gated on the same permission the old sidebar entry used;
  // each page keeps its own (differing) check.
  const sections: SettingsNavSection[] = [personal];

  if (canView(actor.role, "platform-settings:manage")) {
    sections.push({
      label: "Platform",
      items: [
        { href: "/settings/score-settings", label: "Score settings" },
        { href: "/settings/data-handling-rules", label: "Data handling rules" },
        { href: "/settings/restricted-fields", label: "Restricted fields" },
        { href: "/settings/sending-limits", label: "Outreach sending limit" },
        { href: "/settings/cycles", label: "Outreach cycles" },
      ],
    });
  }

  return (
    <>
      <SkipLink />
      <KeyboardShortcutsDialog />
      <AccessibilityAccountSync userId={actor.id} />
      {isViewOnly(actor.role) && <ViewOnlyNotice />}
      <ShellWash />
      <div className="flex min-h-screen">
        <SettingsSidebar
          sections={sections}
          backHref="/dashboard"
          userName={actor.fullName}
          userEmail={actor.email}
          roleLabel={actor.role}
          onLogout={logout}
        />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </main>
      </div>
    </>
  );
}
