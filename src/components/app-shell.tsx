import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { loadViewerState } from "@/lib/dashboard/viewer-state";
import { hasPermission } from "@/lib/auth/permissions";
import { logout } from "@/lib/auth/logout";
import { ONBOARDING_STEPS, shouldShowGuide, type OnboardingUser } from "@/lib/onboarding";
import { DATA_IMPORTS_ROUTES } from "@/app/admin/import-group";
import { AI_ROUTES } from "@/app/admin/ai-group";
import { ANALYTICS_ROUTES } from "@/app/admin/analytics-group";
import { AppShellFrame } from "./app-shell-frame";
import { ShellWash } from "./shell-wash";
import { SkipLink } from "./skip-link";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { AccessibilityAccountSync } from "./accessibility-account-sync";
import type { SidebarSection, SidebarOnboarding } from "./sidebar";

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

  // F168: a personal work queue, gated the same way as the client data it
  // links into (matrix §3.11 SELECT is shared across every active role) —
  // no reason for it to need a narrower permission than /clients itself.
  if (hasPermission(actor.role, "client:view")) {
    sections[0].items.push(
      { href: "/actions", label: "My actions", icon: "actions" },
      // Outreach Inbox — same visibility as Clients: RLS grants every active
      // user SELECT on outreach_messages/reply_events (matrix §3.4).
      { href: "/inbox", label: "Inbox", icon: "inbox" },
      { href: "/clients", label: "Clients", icon: "clients" },
    );
  }

  // One entry for the Data imports group — Import status, Add a client and the
  // importers; each page carries the tab row (src/app/admin/import-group.ts),
  // filtered to the tabs the role can open. CAMs run imports and add clients,
  // so the entry sits in the daily rail rather than the admin section.
  if (hasPermission(actor.role, "client:edit")) {
    sections[0].items.push({
      href: "/admin/import-status",
      label: "Data imports",
      icon: "import",
      matches: DATA_IMPORTS_ROUTES,
    });
  }

  if (hasPermission(actor.role, "tags:manage")) {
    sections[0].items.push({ href: "/admin/tags", label: "Tags", icon: "users" });
  }

  // Second group: oversight and admin tools, separated from the daily rail by
  // the section gap. Analytics sits here (moved down from the daily rail) but
  // keeps its client:view gate, so CAMs keep access — it simply renders in the
  // second section for them. Artificial Intelligence closes the section: same
  // list, no gap after Feedback.
  const oversightItems: SidebarSection["items"] = [];
  if (hasPermission(actor.role, "user:manage")) {
    oversightItems.push({ href: "/admin", label: "Overview", icon: "admin" });
  }
  // One entry for the Analytics group — your numbers and the team's numbers
  // as tabs; each page carries the tab row (src/app/admin/analytics-group.ts),
  // filtered to the tabs the role can open. CAMs keep their numbers: the entry
  // is gated on client:view, and admins see both tabs.
  if (hasPermission(actor.role, "client:view")) {
    oversightItems.push({
      href: "/analytics",
      label: "Analytics",
      icon: "analytics",
      matches: ANALYTICS_ROUTES,
    });
  }
  if (hasPermission(actor.role, "user:manage")) {
    oversightItems.push(
      { href: "/admin/users", label: "Team management", icon: "users" },
      { href: "/admin/review", label: "Review queue", icon: "review" },
      { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
      { href: "/admin/feedback", label: "Feedback", icon: "feedback" },
    );
  }
  // Artificial Intelligence group — AI generation history and Machine Learning
  // as two tabs under one row, mirroring the Data imports pattern. Admin-only
  // (platform-settings:manage, the gate both pages enforce).
  if (hasPermission(actor.role, "platform-settings:manage")) {
    oversightItems.push({
      href: "/admin/ai-generations",
      label: "Artificial Intelligence",
      icon: "ai",
      matches: AI_ROUTES,
    });
  }
  if (oversightItems.length > 0) {
    sections.push({ items: oversightItems });
  }

  // Score settings, data handling rules and restricted fields live under
  // /settings now, reached from the account menu — rare, deliberate
  // configuration does not earn a row in the daily-ops rail.

  let onboarding: SidebarOnboarding | undefined = undefined;

  try {
    const { profile, steps: completedSteps } = await loadViewerState(actor.id);

    const isEligible = shouldShowGuide(
      profile.data
        ? ({
            role: profile.data.role,
            inviteAcceptedAt: profile.data.invite_accepted_at,
            onboardingCompletedAt: profile.data.onboarding_completed_at,
            onboardingDismissedAt: profile.data.onboarding_dismissed_at,
          } satisfies OnboardingUser)
        : null,
    );

    const doneKeys = new Set(
      (completedSteps.data ?? []).map((row: { step_key: string }) => row.step_key),
    );

    const steps = ONBOARDING_STEPS.map((s) => ({
      key: s.key,
      title: s.title,
      href: s.href,
      done: doneKeys.has(s.key),
    }));

    const completedCount = steps.filter((s) => s.done).length;

    onboarding = {
      steps,
      completedCount,
      totalCount: steps.length,
      show: isEligible,
    };
  } catch {
    // A failed read hides the widget rather than showing fake state.
  }

  return (
    <>
      <SkipLink />
      <KeyboardShortcutsDialog />
      <AccessibilityAccountSync userId={actor.id} />
      <ShellWash />
      <AppShellFrame
        sections={sections}
        userName={actor.fullName}
        userEmail={actor.email}
        roleLabel={actor.role}
        onLogout={logout}
        initialCollapsed={initialCollapsed}
        onboarding={onboarding}
      >
        {children}
      </AppShellFrame>
    </>
  );
}
