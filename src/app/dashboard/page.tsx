import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  computeDashboardMetrics,
  filterActiveSuppressed,
  needsAttention,
  organisationGrowthSeries,
  type DashboardOrgRow,
  type OpenSuppression,
} from "@/lib/dashboard-metrics";
import { formatTeamActivities, type FormattedTeamActivity, type RawTeamActivityRow } from "@/lib/team-activity";
import { StatCard } from "@/components/stat-card";
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import { AttentionList } from "@/components/attention-list";
import { TeamActivityFeed } from "@/components/team-activity-feed";
import { FirstRunGuide } from "@/components/first-run-guide";
import { OriginButton } from "@/components/ui/origin-button";
import { OnboardingPreviewBar } from "@/components/onboarding-preview-bar";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import {
  REVIEW_CLIENTS_EMPTY_STATE,
  guideProgress,
  shouldShowGuide,
  type OnboardingUser,
} from "@/lib/onboarding";
import { FeedbackPrompt } from "@/components/feedback-prompt";
import { shouldPromptFeedback } from "@/lib/feedback";

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
  searchParams: Promise<{ error?: string; preview_guide?: string; preview_feedback?: string }>;
}) {
  const { error, preview_guide, preview_feedback } = await searchParams;
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
  let teamActivities: FormattedTeamActivity[] = [];
  let loadFailed = false;

  if (canViewClients) {
    const supabase = await createClient();
    const [organisations, openSuppressions, rawActivity] = await Promise.all([
      supabase
        .from("organisations")
        .select("id, legal_name, outreach_status, owner_id, updated_at, created_at")
        .overrideTypes<DashboardOrgRow[], { merge: false }>(),
      supabase
        .from("suppressions")
        .select("organisation_id, status")
        .in("status", ["pending", "active"])
        .overrideTypes<OpenSuppression[], { merge: false }>(),
      supabase.rpc("get_recent_team_activity", { p_limit: 10 }),
    ]);

    if (organisations.error) {
      await reportError(organisations.error, { operation: "dashboard.page_metrics" });
      loadFailed = true;
    }
    if (openSuppressions.error) {
      await reportError(openSuppressions.error, { operation: "dashboard.page_suppressions" });
      loadFailed = true;
    }
    if (rawActivity.error) {
      await reportError(rawActivity.error, { operation: "dashboard.team_activity" });
    } else {
      teamActivities = formatTeamActivities(
        (rawActivity.data ?? []) as RawTeamActivityRow[],
        actor.id,
      );
    }

    if (!loadFailed) {
      rows = filterActiveSuppressed(organisations.data ?? [], openSuppressions.data ?? []);
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
  //
  // In addition, if `preview_guide` is present in searchParams, we force the guide
  // into one of several preview states for dev/testing regardless of account status.
  let guide: ReturnType<typeof guideProgress> | null = null;
  let ownsAnyClient = false;

  if (preview_guide !== undefined) {
    if (preview_guide === "1") {
      guide = guideProgress(["outreach_preferences"]);
      ownsAnyClient = rows.some((row) => row.owner_id === actor.id);
    } else if (preview_guide === "2" || preview_guide === "complete") {
      guide = guideProgress(["outreach_preferences", "review_clients"]);
      ownsAnyClient = true;
    } else if (preview_guide === "empty") {
      guide = guideProgress([]);
      ownsAnyClient = false;
    } else if (preview_guide === "live") {
      const supabase = await createClient();
      const completedSteps = await supabase.from("user_onboarding_steps").select("step_key");
      guide = guideProgress(
        (completedSteps.data ?? []).map((row: { step_key: string }) => row.step_key),
      );
      ownsAnyClient = rows.some((row) => row.owner_id === actor.id);
    } else {
      // preview_guide === "0" or "true" or default preview
      guide = guideProgress([]);
      ownsAnyClient = rows.some((row) => row.owner_id === actor.id);
    }
  } else if (actor.role === "cam") {
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

  let showFeedback = false;
  if (preview_feedback !== undefined) {
    showFeedback = true;
  } else {
    try {
      const supabase = await createClient();
      const { data: userProfile } = await supabase
        .from("users")
        .select("invite_accepted_at, feedback_snoozed_until")
        .eq("id", actor.id)
        .maybeSingle();

      if (userProfile) {
        showFeedback = shouldPromptFeedback({
          inviteAcceptedAt: userProfile.invite_accepted_at,
          feedbackSnoozedUntil: userProfile.feedback_snoozed_until,
        });
      }
    } catch {
      // Non-fatal: prompt simply doesn't show
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-6xl space-y-10">
        <Rise className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              Dashboard
            </h1>
            
          </div>

          {/* The one accent on the screen: a single pill, glass backdrop + lime hover fill, pointing at
              the screen where the work actually happens. */}
          {canViewClients && (
            <OriginButton
              href="/clients"
              size="md"
              className="shrink-0"
            >
              View all clients
            </OriginButton>
          )}
        </Rise>

        {error === "admin-access-required" && (
          <Rise>
            <InlineAlert variant="page" message="That page is restricted to administrators." />
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
            <InlineAlert variant="page" message="Some data could not be loaded. Refresh and try again." />
          </Rise>
        ) : (
          <>
            <Group className="space-y-4">

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
                  data={growth}
                  period="Past 30 days"
                  periodOptions={[
                    { label: "Past 7 days", points: 7 },
                    { label: "Past 14 days", points: 14 },
                    { label: "Past 30 days" },
                  ]}
                  showFooter={false}
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
                <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">Needs attention</h2>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                  Yours · longest waiting first
                </p>
              </Rise>

              <Rise>
                <AttentionList items={attentionItems} />
              </Rise>
            </Group>

            <Group className="space-y-4">
              <Rise className="flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">Recent team activity</h2>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                  The team · latest actions
                </p>
              </Rise>

              <Rise>
                <TeamActivityFeed items={teamActivities} />
              </Rise>
            </Group>
          </>
        )}
      </Stage>
      {preview_guide !== undefined && <OnboardingPreviewBar currentMode={preview_guide} />}
      {showFeedback && <FeedbackPrompt pageContext="/dashboard" />}
    </div>
  );
}
