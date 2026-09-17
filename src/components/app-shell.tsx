import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { loadViewerState } from "@/lib/dashboard/viewer-state";
import { canView, isViewOnly } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/lib/auth/logout";
import { ONBOARDING_STEPS, shouldShowGuide, type OnboardingUser } from "@/lib/onboarding";
import { DATA_IMPORTS_ROUTES } from "@/app/(app)/admin/import-group";
import { AI_ROUTES } from "@/app/(app)/admin/ai-group";
import { ANALYTICS_ROUTES } from "@/app/(app)/admin/analytics-group";
import { ACTIONS_ROUTES } from "@/app/(app)/actions/actions-group";
import { AppShellFrame } from "./app-shell-frame";
import { ShellWash } from "./shell-wash";
import { SkipLink } from "./skip-link";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { AccessibilityAccountSync } from "./accessibility-account-sync";
import { ViewOnlyNotice } from "./view-only-notice";
import type { SidebarSection, SidebarOnboarding } from "./sidebar";

/**
 * Shared chrome for every signed-in page: sidebar + content area. Each page
 * keeps its own `getViewingActor` gate for the permission it actually needs
 * (see admin pages) — this only re-checks that *some* session is present, to
 * decide what the sidebar should show, and bounces to `/login` otherwise.
 *
 * Rows are gated with `canView`, not `hasPermission`: a viewer (leadership) gets
 * every row an admin does, and is refused at the control, not the menu.
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

  // Actions badge: outstanding work assigned to the viewer — the length of
  // their My tasks queue. A `head: true` count, not rows: the badge needs a
  // number, not the work itself. Fails soft to no badge rather than a wrong
  // zero, so a broken count reads as "no information", not "nothing due".
  // Leadership is never assigned a task, and never sees My tasks, so the
  // badge would always be a zero counting nothing — skip the read entirely.
  let myOpenActionCount: number | undefined;
  if (canView(actor.role, "client:view") && !isViewOnly(actor.role)) {
    try {
      const supabase = await createClient();
      const { count, error } = await supabase
        .from("actions")
        .select("id", { count: "exact", head: true })
        .eq("assignee_user_id", actor.id)
        .eq("status", "open");
      if (!error && typeof count === "number" && count > 0) {
        myOpenActionCount = count;
      }
    } catch {
      myOpenActionCount = undefined;
    }
  }

  // Actions: working through your own queue and handing work out as tabs
  // under one row, mirroring the Analytics group. Everyone lands on My
  // tasks — the queue they open most days — except leadership, who have no
  // queue of their own and land on Team tasks instead. Each page keeps its
  // own gate, and the tab row never offers one the role cannot open.
  //
  // Leadership never reaches My tasks at all: nothing is ever assigned to a
  // viewer, so the page would be a permanently empty queue. They get the whole
  // team's work on Team tasks instead, read-only — the same tab
  // `actionsTabsFor` offers them.
  if (canView(actor.role, "client:view")) {
    sections[0].items.push(
      {
        href: isViewOnly(actor.role) ? "/admin/actions" : "/actions",
        label: "Tasks",
        icon: "actions",
        matches: ACTIONS_ROUTES,
        count: myOpenActionCount,
      },
      // Outreach Inbox — same visibility as Clients: RLS grants every active
      // user SELECT on outreach_messages/reply_events (matrix §3.4).
      { href: "/inbox", label: "Inbox", icon: "inbox" },
      { href: "/clients", label: "Clients", icon: "clients" },
    );
  }

  // One entry for the Data imports group — Import status, Add a client and the
  // importers; each page carries the tab row (src/app/(app)/admin/import-group.ts),
  // filtered to the tabs the role can open. CAMs run imports and add clients,
  // so the entry sits in the daily rail rather than the admin section.
  if (canView(actor.role, "client:edit")) {
    sections[0].items.push({
      href: "/admin/import-status",
      label: "Data imports",
      icon: "import",
      matches: DATA_IMPORTS_ROUTES,
    });
  }

  if (canView(actor.role, "tags:manage")) {
    sections[0].items.push({ href: "/admin/tags", label: "Tags", icon: "users" });
  }

  // Second group: oversight and admin tools, separated from the daily rail by
  // the section gap. Analytics sits here (moved down from the daily rail) but
  // keeps its client:view gate, so CAMs keep access — it simply renders in the
  // second section for them. Artificial Intelligence closes the section: same
  // list, no gap after Feedback.
  const oversightItems: SidebarSection["items"] = [];
  if (canView(actor.role, "user:manage")) {
    oversightItems.push({ href: "/admin", label: "Overview", icon: "admin" });
  }
  // One entry for the Analytics group — your numbers and the team's numbers
  // as tabs; each page carries the tab row (src/app/(app)/admin/analytics-group.ts),
  // filtered to the tabs the role can open. CAMs keep their numbers: the entry
  // is gated on client:view, and admins see both tabs.
  if (canView(actor.role, "client:view")) {
    oversightItems.push({
      // A viewer owns no clients, so their own analytics are always empty.
      href: isViewOnly(actor.role) ? "/admin/analytics" : "/analytics",
      label: "Analytics",
      icon: "analytics",
      matches: ANALYTICS_ROUTES,
    });
  }
  if (canView(actor.role, "user:manage")) {
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
  if (canView(actor.role, "platform-settings:manage")) {
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
      {isViewOnly(actor.role) && <ViewOnlyNotice />}
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
