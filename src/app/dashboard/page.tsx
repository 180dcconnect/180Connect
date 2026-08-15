import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { computeDashboardMetrics, needsAttention, type DashboardOrgRow } from "@/lib/dashboard-metrics";
import { StatCard } from "@/components/stat-card";
import { FirstRunGuide } from "@/components/first-run-guide";
import {
  REVIEW_CLIENTS_EMPTY_STATE,
  guideProgress,
  shouldShowGuide,
  type OnboardingUser,
} from "@/lib/onboarding";

/**
 * F021 — first screen after login. The sidebar (AppShell/F030) already wraps this
 * route via dashboard/layout.tsx; this page adds the top-level metrics (F022-F025)
 * and Needs Attention panel (F027), all on one screen with no extra clicks (AC).
 * See src/lib/dashboard-metrics.ts for how the metrics are defined against the
 * F145 outreach_status pipeline.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  let user;

  try {
    const supabase = await createClient();
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    redirect("/login");
  }

  if (!user) {
    redirect("/login");
  }

  const actorResult = await getCurrentActor();
  if (!actorResult.ok) {
    logSecurityEvent("permission.denied", {
      route: "/dashboard",
      reason: actorResult.reason,
    });
    redirect("/login");
  }
  const actor = actorResult.actor;

  // F258: a read-only account is told so up front, rather than discovering it by
  // pressing a button that fails.
  const canWrite = hasPermission(actor.role, "client:edit");
  const canViewClients = hasPermission(actor.role, "client:view");

  let rows: DashboardOrgRow[] = [];
  let loadFailed = false;

  if (canViewClients) {
    const supabase = await createClient();
    const organisations = await supabase
      .from("organisations")
      .select("id, legal_name, outreach_status, owner_id, updated_at")
      .overrideTypes<DashboardOrgRow[], { merge: false }>();

    if (organisations.error) {
      await reportError(organisations.error, { operation: "dashboard.page_metrics" });
      loadFailed = true;
    } else {
      rows = organisations.data ?? [];
    }
  }

  const metrics = computeDashboardMetrics(rows);
  const attentionItems = needsAttention(rows, actor.id);

  // F255 — the first-run guide. Read both halves of its state together: whether this
  // CAM is still eligible for it (users) and how far through they are
  // (user_onboarding_steps). A failure to read either is not worth failing the
  // dashboard over — the guide simply doesn't render, and the CAM sees the normal
  // screen rather than an error about a checklist.
  let guide: ReturnType<typeof guideProgress> | null = null;
  let ownsAnyClient = false;

  if (actor.role === "cam") {
    const supabase = await createClient();
    const [profile, completedSteps] = await Promise.all([
      supabase
        .from("users")
        .select("role, invite_accepted_at, onboarding_completed_at, onboarding_dismissed_at")
        .eq("id", actor.id)
        .maybeSingle(),
      supabase.from("user_onboarding_steps").select("step_key"),
    ]);

    if (profile.error) {
      await reportError(profile.error, { operation: "dashboard.onboarding_profile" });
    } else if (
      shouldShowGuide(
        profile.data
          ? ({
              role: profile.data.role,
              inviteAcceptedAt: profile.data.invite_accepted_at,
              onboardingCompletedAt: profile.data.onboarding_completed_at,
              onboardingDismissedAt: profile.data.onboarding_dismissed_at,
            } satisfies OnboardingUser)
          : null,
      )
    ) {
      if (completedSteps.error) {
        await reportError(completedSteps.error, { operation: "dashboard.onboarding_steps" });
      }
      // RLS returns this CAM's own rows only, so no user filter is needed here — see
      // matrix §3.12.
      guide = guideProgress(
        (completedSteps.data ?? []).map((row: { step_key: string }) => row.step_key),
      );
      ownsAnyClient = rows.some((row) => row.owner_id === actor.id);
    }
  }

  // Step 2 points at the owner-filtered list (F057) once there is something in it. A
  // brand-new CAM usually owns nothing, and sending them to an empty list with no
  // explanation is the opposite of what a first-run guide is for — so until they own
  // something, the step sends them to the full list to go and claim one.
  const guideSteps = guide?.steps.map((step) =>
    step.key === "review_clients"
      ? {
          ...step,
          href: ownsAnyClient ? `/clients?owner=${actor.id}` : "/clients",
          description: ownsAnyClient ? step.description : REVIEW_CLIENTS_EMPTY_STATE.description,
          cta: ownsAnyClient ? step.cta : REVIEW_CLIENTS_EMPTY_STATE.cta,
        }
      : step,
  );

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-2 text-2xl font-bold">Dashboard</h1>
        <p className="mt-3 text-sm text-foreground/65">
          You are securely logged in as {user.email}.
        </p>

        {error === "admin-access-required" && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-800" role="alert">
            That page is restricted to administrators.
          </p>
        )}
        {!canWrite && (
          <p className="mt-4 rounded-lg bg-black/5 px-4 py-3 text-sm text-foreground/75">
            Your account has read-only access. You can view client records and team
            activity, but not create, edit, or send anything.
          </p>
        )}

        {/* AC1 — a new CAM meets the checklist first, above the metrics that mean
            nothing to them yet, rather than the standard empty dashboard. */}
        {guide && guideSteps && (
          <FirstRunGuide
            steps={guideSteps}
            completedCount={guide.completedCount}
            allDone={guide.allDone}
          />
        )}
        {!canViewClients ? (
          <p className="mt-6 rounded-xl border border-black/10 p-4 text-sm text-foreground/65">
            No workspace tools are available for your role yet. Client records and
            reporting will appear here as they are released.
          </p>
        ) : loadFailed ? (
          <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            Some data could not be loaded. Refresh and try again.
          </p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total charities" value={metrics.totalCharities} />
              <StatCard label="Contacted" value={metrics.contacted} />
              <StatCard label="Responses received" value={metrics.responsesReceived} />
              <StatCard label="Converted" value={metrics.converted} />
            </div>

            <div className="mt-8">
              <h2 className="text-lg font-bold">Needs attention</h2>
              {attentionItems.length === 0 ? (
                <p className="mt-3 text-sm text-foreground/65">
                  Nothing needs your attention right now.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-black/5">
                  {attentionItems.map((item) => (
                    <li key={item.id} className="py-3">
                      <Link
                        href={`/clients/${item.id}`}
                        className="flex items-center justify-between gap-4 hover:bg-black/2.5"
                      >
                        <span className="font-bold">{item.legalName}</span>
                        <span className="rounded-full bg-black/5 px-2 py-1 text-xs font-bold text-foreground/65">
                          {item.outreachStatusLabel}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
