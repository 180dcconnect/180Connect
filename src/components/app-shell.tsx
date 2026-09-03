import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { logout } from "@/lib/auth/logout";
import { ONBOARDING_STEPS, shouldShowGuide, type OnboardingUser } from "@/lib/onboarding";
import { AppShellFrame } from "./app-shell-frame";
import { ShellWash } from "./shell-wash";
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

  if (hasPermission(actor.role, "client:view")) {
    sections[0].items.push({ href: "/clients", label: "Clients", icon: "clients" });
  }

  if (hasPermission(actor.role, "client:view")) {
    sections[0].items.push({ href: "/analytics", label: "Analytics", icon: "analytics" });
  }

  if (hasPermission(actor.role, "client:edit")) {
    sections[0].items.push({ href: "/clients/new", label: "Add client", icon: "add" });
  }

  if (hasPermission(actor.role, "tags:manage")) {
    sections[0].items.push({ href: "/admin/tags", label: "Tags", icon: "users" });
  }

  if (hasPermission(actor.role, "user:manage")) {
    sections.push({
      items: [
        { href: "/admin", label: "Overview", icon: "admin" },
        { href: "/admin/users", label: "Team management", icon: "users" },
        { href: "/admin/analytics", label: "Team analytics", icon: "analytics" },
        { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
        { href: "/admin/import-status", label: "Import status", icon: "import" },
        // Not duplicated here: every admin already has tags:manage, so the
        // main-nav entry above already covers them — a second entry in this
        // section would just show "Tags" twice in the same sidebar.
        { href: "/admin/feedback", label: "Feedback", icon: "feedback" },
      ],
    });
  }

  let onboarding: SidebarOnboarding | undefined = undefined;

  try {
    const supabase = await createClient();
    const [profile, completedSteps] = await Promise.all([
      supabase
        .from("users")
        .select("role, invite_accepted_at, onboarding_completed_at, onboarding_dismissed_at")
        .eq("id", actor.id)
        .maybeSingle(),
      supabase.from("user_onboarding_steps").select("step_key"),
    ]);

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
