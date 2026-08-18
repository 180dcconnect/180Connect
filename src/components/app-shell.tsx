import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { logout } from "@/lib/auth/logout";
import { ONBOARDING_STEPS, shouldShowGuide, type OnboardingUser } from "@/lib/onboarding";
import { AppShellFrame } from "./app-shell-frame";
import type { SidebarSection, SidebarOnboarding } from "./sidebar";

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

  if (hasPermission(actor.role, "client:edit")) {
    sections[0].items.push({ href: "/clients/new", label: "Add client", icon: "add" });
  }

  if (hasPermission(actor.role, "user:manage")) {
    sections.push({
      items: [
        { href: "/admin", label: "Overview", icon: "admin" },
        { href: "/admin/users", label: "Team management", icon: "users" },
        { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
        { href: "/admin/import-status", label: "Import status", icon: "import" },
        { href: "/admin/feedback", label: "Feedback", icon: "feedback" },
      ],
    });
  }

  // Its own trailing section, and ungated: settings are about the person rather
  // than the work, and every role has an account to maintain (F200).
  sections.push({
    items: [{ href: "/settings", label: "Settings", icon: "settings" }],
  });

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

    // Show whenever eligible, or always in development so you can see and test it live
    const show = isEligible || process.env.NODE_ENV !== "production";

    onboarding = {
      steps,
      completedCount,
      totalCount: steps.length,
      show,
    };
  } catch {
    if (process.env.NODE_ENV !== "production") {
      onboarding = {
        steps: ONBOARDING_STEPS.map((s) => ({
          key: s.key,
          title: s.title,
          href: s.href,
          done: false,
        })),
        completedCount: 0,
        totalCount: ONBOARDING_STEPS.length,
        show: true,
      };
    }
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
