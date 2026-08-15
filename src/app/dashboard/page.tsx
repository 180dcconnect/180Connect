import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import {
  computeDashboardMetrics,
  needsAttention,
  organisationGrowthSeries,
  type DashboardOrgRow,
} from "@/lib/dashboard-metrics";
import { StatCard } from "@/components/stat-card";
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import { AttentionList } from "@/components/attention-list";
import { FirstRunGuide } from "@/components/first-run-guide";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import {
  REVIEW_CLIENTS_EMPTY_STATE,
  guideProgress,
  shouldShowGuide,
  type OnboardingUser,
} from "@/lib/onboarding";

/** Eyebrow copy per role. Falls back to a neutral label if a new role lands. */
const WORKSPACE_LABEL: Record<string, string> = {
  admin: "Admin workspace",
  cam: "CAM workspace",
  viewer: "Viewer workspace",
};

/**
 * F021 — first screen after login. The sidebar (AppShell/F030) already wraps this
 * route via dashboard/layout.tsx; this page adds the top-level metrics (F022-F025)
 * and Needs Attention panel (F027), all on one screen with no extra clicks (AC).
 * See src/lib/dashboard-metrics.ts for how the metrics are defined against the
 * F145 outreach_status pipeline.
 *
 * Laid out against docs/design-system.md. The app keeps the shadcn tokens rather
 * than the public palette — that exemption is in the doc — but it takes the
 * system's *character*: content on the bone ground with white cards floating on
 * it (not one box holding everything), a display heading against 11px labels
 * with nothing in between, pills for actions, one accent, and a staged blur-up
 * entrance from the shared brand variants.
 *
 * The root element is a `div`, not a `main`: AppShell already renders the `main`
 * this is slotted into.
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
      .select("id, legal_name, outreach_status, owner_id, updated_at, created_at")
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
  // F022 — the total is now shown as a curve rather than a single number, so the
  // dashboard says how the pipeline got here, not only where it is.
  const growth = organisationGrowthSeries(rows);

  // The meters read as a share of the whole pipeline, so an empty pipeline has to
  // draw an empty bar rather than divide by zero.
  const share = (value: number) =>
    metrics.totalCharities === 0 ? 0 : value / metrics.totalCharities;
  const shareCaption = (value: number) =>
    metrics.totalCharities === 0
      ? "No records yet"
      : `${Math.round(share(value) * 100)}% of the pipeline`;

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
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-6xl space-y-10">
        <Rise className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            {/* Not the product name — the sidebar already carries that two
                inches to the left. The eyebrow says whose workspace this is,
                matching /admin's "Admin workspace". */}
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              {WORKSPACE_LABEL[actor.role] ?? "Workspace"}
            </p>
            <h1 className="mt-2 text-[clamp(2rem,4vw,2.75rem)] font-black leading-[1] tracking-[-0.03em]">
              Dashboard
            </h1>
            
          </div>

          {/* The one accent on the screen: a single pill, brand green, pointing at
              the screen where the work actually happens. */}
          {canViewClients && (
            <Link
              href="/clients"
              className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              View all clients
              <span
                aria-hidden="true"
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          )}
        </Rise>

        {error === "admin-access-required" && (
          <Rise>
            <p
              role="alert"
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive"
            >
              That page is restricted to administrators.
            </p>
          </Rise>
        )}

        {!canWrite && (
          <Rise>
            <div className="rounded-2xl border border-black/[0.06] bg-white px-5 py-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                Read-only access
              </p>
              <p className="mt-2 text-sm leading-[1.7] text-foreground/65">
                You can view client records and team activity, but not create, edit,
                or send anything.
              </p>
            </div>
          </Rise>
        )}

        {/* AC1 — a new CAM meets the checklist first, above the metrics that mean
            nothing to them yet, rather than the standard empty dashboard. */}
        {guide && guideSteps && (
          <Rise>
            <FirstRunGuide
              steps={guideSteps}
              completedCount={guide.completedCount}
              allDone={guide.allDone}
            />
          </Rise>
        )}

        {!canViewClients ? (
          <Rise>
            <div className="rounded-2xl border border-black/[0.06] bg-white px-5 py-6 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                Nothing here yet
              </p>
              <p className="mt-2 max-w-xl text-sm leading-[1.7] text-foreground/65">
                No workspace tools are available for your role yet. Client records and
                reporting will appear here as they are released.
              </p>
            </div>
          </Rise>
        ) : loadFailed ? (
          <Rise>
            <p
              role="alert"
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive"
            >
              Some data could not be loaded. Refresh and try again.
            </p>
          </Rise>
        ) : (
          <>
            <Group className="space-y-4">
              <Rise className="flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-black tracking-[-0.02em]">Pipeline</h2>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                  Platform-wide
                </p>
              </Rise>

              {/* The headline metric gets the whole width: it carries a 30-day
                  curve, and the three status counts read as its breakdown
                  underneath. */}
              <Rise>
                <ProgressMetricCard
                  size="lg"
                  title="Total Organisations"
                  total={metrics.totalCharities.toLocaleString()}
                  unit="organisations"
                  accent="brand"
                  deltaLabel="added today"
                  data={growth}
                  period="Past 30 days"
                  periodOptions={[
                    { label: "Past 7 days", points: 7 },
                    { label: "Past 14 days", points: 14 },
                    { label: "Past 30 days" },
                  ]}
                  showStats={false}
                  className="rounded-2xl border-black/[0.06] shadow-sm"
                />
              </Rise>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Rise>
                  <StatCard
                    label="Contacted"
                    value={metrics.contacted}
                    share={share(metrics.contacted)}
                    caption={shareCaption(metrics.contacted)}
                  />
                </Rise>
                <Rise>
                  <StatCard
                    label="Responses received"
                    value={metrics.responsesReceived}
                    share={share(metrics.responsesReceived)}
                    caption={shareCaption(metrics.responsesReceived)}
                  />
                </Rise>
                <Rise>
                  <StatCard
                    label="Converted"
                    value={metrics.converted}
                    share={share(metrics.converted)}
                    caption={shareCaption(metrics.converted)}
                    emphasis
                  />
                </Rise>
              </div>
            </Group>

            <Group className="space-y-4">
              <Rise className="flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-black tracking-[-0.02em]">Needs attention</h2>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                  Yours · longest waiting first
                </p>
              </Rise>

              <Rise>
                <AttentionList items={attentionItems} />
              </Rise>
            </Group>
          </>
        )}
      </Stage>
    </div>
  );
}
