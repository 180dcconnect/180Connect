import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPaged } from "@/lib/supabase/fetch-paged";
import { getOutreachEngineHealth, type OutreachEngineHealth } from "@/lib/gmail/engine-status.ts";
import { fetchAdminQueueTally } from "@/lib/dashboard/admin-queue";
import { logSecurityEvent } from "@/lib/log-security-event";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission, canView, seesAdminView } from "@/lib/auth/permissions";
import { formatMyActions, type ActionRow } from "@/lib/actions";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  computeDashboardMetrics,
  filterActiveSuppressed,
  organisationGrowthSeries,
  type DashboardOrgRow,
  type GrowthPoint,
  type OpenSuppression,
} from "@/lib/dashboard-metrics";
import {
  computePerformance,
  FUNNEL_TREND_DAYS,
  funnelTrendSeries,
  performanceInputForClient,
  pipelineTrendSeries,
  queueBands,
  sectorPerformance,
  trendWindowStart,
  type ConvertedOutcomeRow,
  type FunnelTrendSeries,
  type LatestScoreRow,
  type PerformanceInput,
  type PerformanceSummary,
  type QueueBands,
  type ReplyEventRow,
  type SectorPerformanceRow,
  type SentMessageRow,
  type TeamUserRow,
} from "@/lib/performance-metrics";
import { formatTeamActivities, type FormattedTeamActivity, type RawTeamActivityRow } from "@/lib/team-activity";
import {
  buildRecentUpdates,
  recentUpdatesCutoff,
  RECENT_UPDATES_SOURCE_FETCH_CAP,
  type FormattedRecentUpdate,
  type RecentAuditRow,
  type RecentNoteRow,
  type RecentOutreachMessageRow,
  type RecentReplyEventRow,
  type ActorPreview,
  type OrganisationPreview,
} from "@/lib/recent-updates";
import { myWorkSummary, type MyWorkSummary } from "@/lib/dashboard/my-work";
import { summariseMyDesk, type DeskDraft, type MyDesk } from "@/lib/dashboard/my-desk";
import { mergeDashboardFeed } from "@/lib/dashboard/recent-feed";
import { camLeaderboard } from "@/lib/dashboard/cam-leaderboard";
import {
  DEFAULT_OUTREACH_DAILY_SEND_LIMIT,
  dailySendWindowStart,
} from "@/lib/outreach/daily-send-limit";
import {
  newestMissionPerOrg,
  resolveMissionText,
  type EnrichmentMissionRow,
} from "@/lib/mission";
import {
  selectPriorityOpportunities,
  type OpportunityFactors,
  type PriorityOpportunity,
} from "@/lib/priority-opportunities";
import {
  aiSpendSummary,
  aiSpendWindowStart,
  toAiGenerationActivity,
  type AiGenerationCostRow,
  type AiSpendSummary,
} from "@/lib/dashboard/ai-spend";
import { loadViewerState } from "@/lib/dashboard/viewer-state";
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import { RecentUpdatesFeed } from "@/components/recent-updates-feed";
import { FirstRunGuide } from "@/components/first-run-guide";
import { OriginButton } from "@/components/ui/origin-button";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { AdminActionCenter, type AdminQueueCounts } from "@/components/dashboard/admin-action-center";
import { QueueQualityCard } from "@/components/dashboard/queue-quality-card";
import { PerformanceSection } from "@/components/dashboard/performance-section";
import { CamLeaderboardTable } from "@/components/dashboard/cam-leaderboard-table";
import { MyWorkStrip } from "@/components/dashboard/my-work-strip";
import { PriorityOpportunitiesCard } from "@/components/dashboard/priority-opportunities-card";
import { MyActionsCard } from "@/components/dashboard/my-actions-card";
import { SendingCapacityCard, type SendingCapacity } from "@/components/dashboard/sending-capacity-card";
import { AiSpendCard } from "@/components/dashboard/ai-spend-card";
import { DataHealthCard } from "@/components/dashboard/data-health-card";
import { SystemHealthCard } from "@/components/dashboard/system-health-card";
import { readDataHealth, readSystemHealth, type DataHealthReads } from "@/lib/dashboard/health-reads";
import { countCreatedSince, summariseDataHealth } from "@/lib/dashboard/data-health";
import { summariseSystemHealth, type SystemHealthInput } from "@/lib/dashboard/system-health";
import {
  REVIEW_CLIENTS_EMPTY_STATE,
  guideProgress,
  shouldShowGuide,
  type OnboardingUser,
} from "@/lib/onboarding";
import { FeedbackPrompt } from "@/components/feedback-prompt";
import { shouldPromptFeedback } from "@/lib/feedback";
import {
  formatResponseTime,
  summariseTrackedReplies,
  type ReplyTrackingRow,
} from "@/lib/reply-analytics";
import { StatCard } from "@/components/stat-card";

/** An unsent draft as read, before it is narrowed to the viewer's own clients. */
type DraftRow = { id: string; organisation_id: string; subject: string | null; updated_at: string };

/** As read: `activity` is plain text until `toAiGenerationActivity` narrows it. */
type RawAiGenerationCostRow = Omit<AiGenerationCostRow, "activity"> & { activity: string | null };

/**
 * The `latest_scores` read plus the persisted per-factor breakdown, which the
 * Priority Opportunities card explains in plain English. Kept out of
 * `LatestScoreRow` (and stripped back out before `performanceInputForClient`)
 * so the breakdown never rides to the browser inside the Performance section's
 * serialised input.
 */
type DashboardScoreRow = LatestScoreRow & {
  score_factors: { factors: OpportunityFactors } | null;
};

/**
 * One outreach-engine check that is not reporting active.
 *
 * `stop` is something broken — a revoked Gmail connection, a scheduler that has
 * stopped ticking. `hold` is something never set up, which on a staging
 * deployment is expected and not an outage.
 */
type EngineIssue = { label: string; detail: string; severity: "stop" | "hold" };

/**
 * The engine's failing checks, in the order the inbox's status card lists them.
 *
 * Only what is *not* active becomes an issue: the dashboard has no room for a
 * status strip that is green every day, and a row nobody reads is how the one
 * day it matters gets missed. `getOutreachEngineHealth` never throws — each
 * check degrades on its own — so there is nothing to catch here.
 */
function engineIssuesFrom(health: OutreachEngineHealth): EngineIssue[] {
  const checks = [
    { label: "Gmail connection", status: health.transport.status, detail: health.transport.detail },
    { label: "Reply sync", status: health.replySync.status, detail: health.replySync.detail },
    { label: "Scheduled send", status: health.scheduledSend.status, detail: health.scheduledSend.detail },
  ];

  return checks
    .filter((check) => check.status !== "active")
    .map((check) => ({
      label: check.label,
      detail: check.detail,
      severity: check.status === "unconfigured" ? ("hold" as const) : ("stop" as const),
    }));
}

/**
 * The "Outreach engine needs attention" banner, streamed.
 *
 * The engine checks include a live round trip to Gmail that can take up to ~6s
 * when Gmail is slow. Awaiting them in the page held every other card on the
 * dashboard back for that long; awaited here, under a Suspense boundary with no
 * fallback, the dashboard paints at once and the banner appears when — and only
 * if — a check is not active. A healthy engine still renders nothing.
 */
async function EngineHealthBanner({ health }: { health: Promise<OutreachEngineHealth> }) {
  const engineIssues = engineIssuesFrom(await health);
  if (engineIssues.length === 0) return null;

  // Whether the engine banner reads as "broken" or "not set up yet".
  const engineStop = engineIssues.some((issue) => issue.severity === "stop");

  return (
    <Rise>
      <section
        aria-labelledby="engine-health-heading"
        className={`rounded-panel border px-5 py-4 ${
          engineStop ? "border-stop/25 bg-stop-wash/50" : "border-hold/25 bg-hold-wash/50"
        }`}
      >
        <h2
          id="engine-health-heading"
          className={`font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] ${
            engineStop ? "text-stop" : "text-hold"
          }`}
        >
          Outreach engine needs attention
        </h2>
        <ul className="mt-2 space-y-1">
          {engineIssues.map((issue) => (
            <li key={issue.label} className="font-body text-[13px] leading-[1.55] text-dim">
              <span className="font-semibold text-ink">{issue.label}</span> — {issue.detail}
            </li>
          ))}
        </ul>
        <Link
          href="/inbox"
          className="mt-2 inline-block font-body text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
        >
          Open the inbox →
        </Link>
      </section>
    </Rise>
  );
}

/**
 * Data health and System health, streamed — admins and leadership only.
 *
 * Their reads start alongside the page's own and are awaited here, under a
 * Suspense boundary, so a slow count or the Gmail round trip never holds the
 * rest of the dashboard back. Both reads never reject (see health-reads.ts).
 * `orgFacts` comes from the organisations the page has already loaded rather
 * than three more queries for numbers already in memory.
 */
async function HealthCards({
  reads,
  orgFacts,
}: {
  reads: Promise<[DataHealthReads, Omit<SystemHealthInput, "now">]>;
  orgFacts: { organisations: number; addedRecently: number; missingWebsite: number };
}) {
  const [dataReads, systemReads] = await reads;
  const now = new Date();

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <Rise className="h-full">
        <DataHealthCard summary={summariseDataHealth({ now, ...orgFacts, ...dataReads })} />
      </Rise>
      <Rise className="h-full">
        <SystemHealthCard summary={summariseSystemHealth({ now, ...systemReads })} />
      </Rise>
    </div>
  );
}

/**
 * F021 — first screen after login. The sidebar (AppShell/F030) already wraps this
 * route via (app)/layout.tsx; this page adds the top-level metrics (F022-F025)
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
  searchParams: Promise<{ error?: string; preview_feedback?: string }>;
}) {
  const { error, preview_feedback } = await searchParams;

  // No separate `auth.getUser()` pre-check: `getCurrentActor` already resolves
  // the session and returns `unauthenticated` when there is none, so asking the
  // Auth server first was a second network round trip to learn the same thing —
  // and it bounced to /login on a transient failure rather than on a real
  // absence of session.
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
  let recentUpdates: FormattedRecentUpdate[] = [];
  let adminCounts: AdminQueueCounts | null = null;
  let trackedReplies: ReplyTrackingRow[] = [];
  let loadFailed = false;
  // Clients nobody owns. Read for every role rather than inside the admin block
  // below, because it is a CAM's only route into work when their own book is
  // empty — see the empty-book card in the render.
  //
  // This is the whole pool, and it is deliberately not the number the duty queue
  // shows: see `unassignedHighPriorityCount` below, which narrows it to the
  // clients worth chasing. Two counts because they answer two questions —
  // "is there anything at all for a CAM to pick up" and "does an admin have
  // valuable work to place".
  let unassignedCount = 0;
  // Actively-suppressed clients dropped from every total on this page.
  let suppressedCount = 0;
  // The live outreach-engine checks, still in flight when the page renders. Not
  // awaited here: the banner streams in behind its own Suspense boundary, so a
  // slow Gmail check (it can take up to ~6s) no longer holds the whole dashboard
  // back. Null for an actor who cannot send, which renders no banner at all.
  let engineHealthPromise: Promise<OutreachEngineHealth> | null = null;
  // Owned organisations in `responded` status whose inbound reply has not been
  // read yet by this actor (INBOX_THREAD_STATE.read_state !== 'read').
  let unreadInboundOrgIds: Set<string> | undefined;

  // F213 — admin-only month-to-date AI spend, plus the equal-length prior
  // stretch it is compared against.
  let aiSpend: AiSpendSummary | null = null;

  // Data health and System health — admins and leadership only. The reads are
  // started with the others and streamed in by `HealthCards`; `orgHealthFacts`
  // is filled from the organisations read once it lands.
  let healthReads: Promise<[DataHealthReads, Omit<SystemHealthInput, "now">]> | null = null;
  let orgHealthFacts: { organisations: number; addedRecently: number; missingWebsite: number } | null = null;

  // Performance section state — null when its reads fail, so the rest of the
  // dashboard still renders (every section here fails independently).
  let performance: {
    summary: PerformanceSummary;
    trend: GrowthPoint[];
    funnel: FunnelTrendSeries;
    sectors: SectorPerformanceRow[];
    queue: { bands: QueueBands; scored: number };
    cams: TeamUserRow[];
    raw: PerformanceInput;
    sectorByOrg: Map<string, string | null>;
  } | null = null;

  // "Your Priority Opportunities": this viewer's own book plus unclaimed
  // clients, ranked by score. Built off the reads above — no extra query.
  // `scoresLoaded` is false when the latest_scores read failed, so the card
  // hides rather than claiming there is nothing worth talking to.
  let priorityOpportunities: PriorityOpportunity[] = [];
  let scoresLoaded = false;

  // Every read on this page that does not need another read's result is started
  // before the first one is awaited, so they all leave for the database together.
  // The page used to await them in about fourteen rounds, one after another, and
  // each round is a full trip between the function and the database — so the
  // dashboard took as long as all of those trips laid end to end.
  //
  // PostgREST builders are lazy: a query runs only once something calls `then`
  // on it. `start` does that straight away, so the query is in flight while the
  // rest of this function carries on building.
  const start = <T,>(query: PromiseLike<T>): Promise<T> => Promise.resolve(query);
  const supabase = await createClient();

  // The first-run guide and the feedback prompt read the same `users` row and
  // step list AppShell reads for the sidebar; `loadViewerState` is cached per
  // request, so all three share one read. Marked handled here because a branch
  // below may never await it.
  const viewerState = loadViewerState(actor.id);
  viewerState.catch(() => {});

  // "Your actions" — every open action assigned to this person, the same read
  // the Actions page makes, so the card and that page agree about what is
  // overdue. Only for accounts that can hold work; a view-only account has none.
  const actionsRead = canWrite
    ? start(
        supabase
          .from("actions")
          .select(
            "id, title, description, due_date, status, organisation_id, created_by_user_id, created_at, " +
              "organisation:organisations!actions_organisation_id_fkey(legal_name), " +
              "created_by_user:users!actions_created_by_user_id_fkey(full_name)",
          )
          .eq("assignee_user_id", actor.id)
          .eq("status", "open")
          .order("created_at", { ascending: true }),
      )
    : null;

  // Sending capacity — the branch-wide daily limit, what has gone out since
  // UK midnight, and what is scheduled to go before the next one. The same day
  // boundary the send RPCs enforce (daily-send-limit.ts). Three small counts.
  const sendWindowStart = dailySendWindowStart();
  // Noon tomorrow (UK) resolves to tomorrow's midnight, whatever the clock change.
  const sendWindowEnd = dailySendWindowStart(
    new Date(Date.parse(sendWindowStart) + 36 * 60 * 60 * 1000),
  );
  const sendingCapacityRead = canViewClients
    ? Promise.all([
        start(
          supabase
            .from("outreach_daily_send_limit")
            .select("daily_limit")
            .eq("id", true)
            .maybeSingle(),
        ),
        start(
          supabase
            .from("outreach_messages")
            .select("id", { count: "exact", head: true })
            .eq("send_status", "sent")
            .gte("sent_at", sendWindowStart),
        ),
        start(
          supabase
            .from("outreach_messages")
            .select("id", { count: "exact", head: true })
            .eq("send_status", "scheduled")
            .lt("scheduled_at", sendWindowEnd),
        ),
      ])
    : null;

  if (canViewClients) {
    // F028: each recent-updates source is windowed and capped at the query
    // level; buildRecentUpdates re-filters by the same cutoff after merging,
    // so a note created before the window but edited inside it still shows.
    // ISO string, not a Date — postgrest-js interpolates filter values raw,
    // so a Date would serialize as "Sat Aug 08 2026 … (Coordinated Universal
    // Time)" and 400 every one of these queries.
    const updateCutoff = recentUpdatesCutoff().toISOString();

    // Organisations and suppressions are not windowed: the dashboard needs the
    // full pipeline to compute metrics and to build the org-name map that
    // recent-updates filters against. PostgREST caps a single response at
    // 1000 rows, so a plain `.select()` silently truncates once the table grows
    // past that — the 1794-row staging dataset already hit this, dropping the
    // two recently-claimed orgs and making recent-updates and needs-attention
    // appear empty. Paginate until the server returns fewer than a full page.
    // Every whole-table read pages the same way. `pagesPerRound` asks for that
    // many pages at once: a table that runs to a few thousand rows
    // (organisations, latest_scores) comes back in one round instead of one
    // round per thousand rows. Overshooting the end costs one empty page.
    // The loop itself is the shared `fetchPaged`, which /clients, /inbox and
    // /analytics page through too.
    const fetchAllRows = <T,>(
      buildPage: (
        from: number,
        to: number,
      ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
      pagesPerRound = 1,
    ) => fetchPaged<T>(buildPage, { pagesPerRound });

    const fetchAllOrganisations = () =>
      fetchAllRows<DashboardOrgRow>(
        (from, to) =>
          supabase
            .from("organisations")
            .select(
              "id, legal_name, outreach_status, owner_id, updated_at, created_at, sector, organisation_type, city, country_code, website, charity_activities, cic_community_statement",
            )
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to)
            .overrideTypes<DashboardOrgRow[], { merge: false }>(),
        4,
      );

    // Every reply, for the turnaround summary — ordered so the pages are
    // stable across the loop, and typed through overrideTypes because the
    // select is narrower than the generated row type.
    const fetchAllTrackedReplies = () =>
      fetchAllRows<ReplyTrackingRow>((from, to) =>
        supabase
          .from("reply_events")
          .select("id, organisation_id, response_time_seconds")
          .order("received_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
          .overrideTypes<ReplyTrackingRow[], { merge: false }>(),
      );

    const fetchAllOpenSuppressions = () =>
      fetchAllRows<OpenSuppression>((from, to) =>
        supabase
          .from("suppressions")
          .select("organisation_id, status")
          .in("status", ["pending", "active"])
          .order("organisation_id", { ascending: true })
          .range(from, to)
          .overrideTypes<OpenSuppression[], { merge: false }>(),
      );

    // Live sending health — the Gmail transport plus the reply-sync and
    // scheduled-send cron jobs. Started here so it overlaps the mailbox reads,
    // and never awaited by the page itself: `EngineHealthBanner` awaits it
    // inside a Suspense boundary, so the rest of the dashboard paints first.
    // Only for an actor who can actually send: a viewer has no outreach to be
    // broken, and the check is a live Gmail round trip.
    // Viewers see sending health too: it is a reading, not a control.
    engineHealthPromise = canView(actor.role, "client:edit") ? getOutreachEngineHealth(supabase) : null;

    const auditRead = start(
      supabase
        .from("audit_log")
        .select("id, actor_user_id, action, detail, created_at, target_id")
        .eq("target_table", "organisations")
        .in("action", ["status_changed", "ownership_reassigned"])
        .gte("created_at", updateCutoff)
        .order("created_at", { ascending: false })
        .limit(RECENT_UPDATES_SOURCE_FETCH_CAP),
    );

    // audit_log's actor_user_id and detail.from/detail.to are bare uuids
    // (jsonb, not an FK PostgREST can embed), resolved in one batch — same
    // approach as the client timeline page. Chained onto the audit read, so the
    // lookup leaves the moment those rows land rather than after every other read.
    const auditNames = auditRead.then(async ({ data }) => {
      const referencedUserIds = new Set<string>();
      for (const row of (data ?? []) as unknown as RecentAuditRow[]) {
        if (row.actor_user_id) referencedUserIds.add(row.actor_user_id);
        const detail =
          row.detail && typeof row.detail === "object"
            ? (row.detail as Record<string, unknown>)
            : {};
        if (typeof detail.from === "string") referencedUserIds.add(detail.from);
        if (typeof detail.to === "string") referencedUserIds.add(detail.to);
      }

      const names = new Map<string, string | null>();
      if (referencedUserIds.size > 0) {
        const { data: referencedUsers } = await supabase
          .from("users")
          .select("id, full_name")
          .in("id", Array.from(referencedUserIds));
        for (const row of referencedUsers ?? []) {
          names.set(row.id, row.full_name);
        }
      }
      return names;
    });

    // Performance section — one 90-day window, five reads. Every table here
    // is readable by every role (matrix §3.1, §3.4, §3.6), so this is not an
    // admin-only view; the section itself decides who may pick which CAM.
    // Same ISO-string discipline as updateCutoff above: postgrest-js
    // interpolates filter values raw, so a Date would 400 every query.
    const perfCutoff = trendWindowStart(new Date()).toISOString();

    // Funnel chart — the same three events over a full year, but organisation
    // and date only: the chart buckets distinct clients per day server-side,
    // so a year of events crosses to the browser as three small arrays rather
    // than thousands of rows. Started with the reads above, awaited with them.
    const funnelCutoff = trendWindowStart(new Date(), FUNNEL_TREND_DAYS).toISOString();
    const funnelReads = Promise.all([
      fetchAllRows<{ organisation_id: string; sent_at: string | null }>((from, to) =>
        supabase
          .from("outreach_messages")
          .select("organisation_id, sent_at")
          .eq("send_status", "sent")
          .gte("sent_at", funnelCutoff)
          .order("sent_at", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<{ organisation_id: string; received_at: string }>((from, to) =>
        supabase
          .from("reply_events")
          .select("organisation_id, received_at")
          .gte("received_at", funnelCutoff)
          .order("received_at", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<{ organisation_id: string; created_at: string }>((from, to) =>
        supabase
          .from("outcomes")
          .select("organisation_id, created_at")
          .eq("outcome_type", "converted")
          .gte("created_at", funnelCutoff)
          .order("created_at", { ascending: true })
          .range(from, to),
      ),
    ]);

    const performanceReads = Promise.all([
      fetchAllRows<SentMessageRow>((from, to) =>
        supabase
          .from("outreach_messages")
          .select("id, sent_at, sent_by_user_id, organisation_id")
          .eq("send_status", "sent")
          .gte("sent_at", perfCutoff)
          .order("sent_at", { ascending: true })
          .range(from, to)
          .overrideTypes<SentMessageRow[], { merge: false }>(),
      ),
      fetchAllRows<ReplyEventRow>((from, to) =>
        supabase
          .from("reply_events")
          .select("id, received_at, outreach_message_id, organisation_id")
          .gte("received_at", perfCutoff)
          .order("received_at", { ascending: true })
          .range(from, to)
          .overrideTypes<ReplyEventRow[], { merge: false }>(),
      ),
      fetchAllRows<ConvertedOutcomeRow>((from, to) =>
        supabase
          .from("outcomes")
          .select("id, created_at, recorded_by_user_id, organisation_id")
          .eq("outcome_type", "converted")
          .gte("created_at", perfCutoff)
          .order("created_at", { ascending: true })
          .range(from, to)
          .overrideTypes<ConvertedOutcomeRow[], { merge: false }>(),
      ),
      // The queue band distribution reads the whole table — a band added
      // before the window still belongs to the queue. score_factors rides
      // along for the Priority Opportunities card's plain-English reasons
      // (stripped back out before anything crosses to the client).
      fetchAllRows<DashboardScoreRow>(
        (from, to) =>
          supabase
            .from("latest_scores")
            .select("organisation_id, priority_band, priority_score, scored_at, score_factors")
            .order("organisation_id", { ascending: true })
            .range(from, to)
            .overrideTypes<DashboardScoreRow[], { merge: false }>(),
        4,
      ),
      fetchAllRows<TeamUserRow>((from, to) =>
        supabase
          .from("users")
          .select("id, full_name, role, email, last_seen_at, is_active")
          .order("full_name", { ascending: true })
          .range(from, to)
          .overrideTypes<TeamUserRow[], { merge: false }>(),
      ),
    ]);

    // F213 — month-to-date spend needs the current month plus the equal-length
    // stretch before it, so the window starts where `aiSpendSummary` does and
    // it splits the rows. The same `aiSpendNow` goes to both, so the fetch and
    // the split agree on the boundary. Every role can read AI_GENERATIONS
    // (§3.4), but the budget is an admin concern, so these reads are
    // admin-only rather than the tile being hidden client-side.
    const aiSpendNow = new Date();
    const adminReads =
      seesAdminView(actor.role)
        ? (() => {
            const aiWindowStart = aiSpendWindowStart(aiSpendNow).toISOString();
            return Promise.all([
              // F181's approval queues, counted in one place
              // (src/lib/dashboard/admin-queue.ts).
              fetchAdminQueueTally(supabase),
              fetchAllRows<RawAiGenerationCostRow>((from, to) =>
                supabase
                  .from("ai_generations")
                  .select("created_at, cost_usd, total_tokens, model, activity")
                  .gte("created_at", aiWindowStart)
                  .order("created_at", { ascending: true })
                  .range(from, to)
                  .overrideTypes<RawAiGenerationCostRow[], { merge: false }>(),
              ),
              // Paged like ai_generations: a plain select would silently
              // truncate past PostgREST's 1000-row window and undercount spend.
              fetchAllRows<{
                created_at: string;
                cost_usd: number | null;
                total_tokens: number | null;
                model: string | null;
                input_tokens: number | null;
                output_tokens: number | null;
              }>((from, to) =>
                supabase
                  .from("booklet_generations")
                  .select("created_at, cost_usd, total_tokens, model, input_tokens, output_tokens")
                  .gte("created_at", aiWindowStart)
                  .order("created_at", { ascending: true })
                  .range(from, to),
              ),
            ]);
          })()
        : null;

    // Started here so they overlap every read below; awaited only inside the
    // Suspense boundary, so they never delay the page. Reuses the engine check
    // above instead of asking Gmail a second time.
    healthReads = seesAdminView(actor.role)
      ? Promise.all([readDataHealth(supabase), readSystemHealth(supabase, engineHealthPromise)])
      : null;

    const [organisations, openSuppressions, replyTracking, rawActivity, rawUpdateNotes, rawUpdateMessages, rawUpdateReplies, rawUpdateAudit] =
      await Promise.all([
        fetchAllOrganisations(),
        fetchAllOpenSuppressions(),
        fetchAllTrackedReplies(),
        supabase.rpc("get_recent_team_activity", { p_limit: 10 }),
        supabase
          .from("notes")
          .select(
            "id, content, created_at, updated_at, organisation_id, author:users!notes_author_id_fkey(full_name)",
          )
          .or(`created_at.gte.${updateCutoff},updated_at.gte.${updateCutoff}`)
          .order("created_at", { ascending: false })
          .limit(RECENT_UPDATES_SOURCE_FETCH_CAP),
        supabase
          .from("outreach_messages")
          .select(
            "id, subject, send_status, sent_at, organisation_id, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)",
          )
          .eq("send_status", "sent")
          .gte("sent_at", updateCutoff)
          .order("sent_at", { ascending: false })
          .limit(RECENT_UPDATES_SOURCE_FETCH_CAP),
        supabase
          .from("reply_events")
          .select("id, reply_body, received_at, organisation_id")
          .gte("received_at", updateCutoff)
          .order("received_at", { ascending: false })
          .limit(RECENT_UPDATES_SOURCE_FETCH_CAP),
        auditRead,
      ]);

    if (organisations.error) {
      await reportError(organisations.error, { operation: "dashboard.page_metrics" });
      loadFailed = true;
    }
    if (openSuppressions.error) {
      await reportError(openSuppressions.error, { operation: "dashboard.page_suppressions" });
      loadFailed = true;
    }
    if (replyTracking.error) {
      await reportError(replyTracking.error, { operation: "dashboard.reply_tracking" });
      loadFailed = true;
    } else {
      trackedReplies = replyTracking.data ?? [];
    }
    if (rawActivity.error) {
      await reportError(rawActivity.error, { operation: "dashboard.team_activity" });
    }

    // F028 sources fail independently, like every other section on this page:
    // reported, not fatal — a failed notes query shouldn't hide the replies
    // that did load.
    for (const [source, result] of [
      ["recent_updates.notes", rawUpdateNotes],
      ["recent_updates.messages", rawUpdateMessages],
      ["recent_updates.replies", rawUpdateReplies],
      ["recent_updates.audit", rawUpdateAudit],
    ] as const) {
      if (result.error) {
        await reportError(result.error, { operation: `dashboard.${source}` });
      }
    }

    if (!loadFailed) {
      rows = filterActiveSuppressed(organisations.data ?? [], openSuppressions.data ?? []);
      unassignedCount = rows.filter((row) => row.owner_id === null).length;
      // Pending suppressions are deliberately not counted here — they stay in
      // the totals until approved, which is what filterActiveSuppressed just
      // applied, so the two numbers tell one story instead of two.
      suppressedCount = (organisations.data?.length ?? 0) - rows.length;

      if (healthReads) {
        // Every record held, suppressed ones included: this is about the data,
        // not the pipeline totals above.
        const allOrganisations = organisations.data ?? [];
        orgHealthFacts = {
          organisations: allOrganisations.length,
          addedRecently: countCreatedSince(allOrganisations, new Date()),
          missingWebsite: allOrganisations.filter((row) => !row.website?.trim()).length,
        };
      }

      const respondedMineOrgIds = canViewClients
        ? rows
            .filter((row) => row.owner_id === actor.id && row.outreach_status === "responded")
            .map((row) => row.id)
        : [];

      const threadStatesPromise = respondedMineOrgIds.length > 0
        ? supabase
            .from("inbox_thread_state")
            .select("organisation_id, read_state")
            .eq("user_id", actor.id)
            .in("organisation_id", respondedMineOrgIds)
        : null;

      const [perfMessages, perfReplies, perfConversions, perfScores, perfUsers] =
        await performanceReads;

      // The funnel chart's year of events lands with the reads above — same
      // fail-soft shape: a broken funnel read empties the chart, never the page.
      const [funnelMessages, funnelReplies, funnelConversions] = await funnelReads;

      const perfErrors = [
        ["performance.messages", perfMessages.error],
        ["performance.replies", perfReplies.error],
        ["performance.conversions", perfConversions.error],
        ["performance.scores", perfScores.error],
        ["performance.users", perfUsers.error],
      ] as const;
      let perfFailed = false;
      for (const [source, err] of perfErrors) {
        if (err) {
          await reportError(err, { operation: `dashboard.${source}` });
          perfFailed = true;
        }
      }

      // The funnel chart degrades on its own: a broken year-long read empties
      // the chart (its card renders its own empty state), never the section.
      let funnelFailed = false;
      for (const [source, err] of [
        ["performance.funnel.messages", funnelMessages.error],
        ["performance.funnel.replies", funnelReplies.error],
        ["performance.funnel.conversions", funnelConversions.error],
      ] as const) {
        if (err) {
          await reportError(err, { operation: `dashboard.${source}` });
          funnelFailed = true;
        }
      }

      if (!perfFailed) {
        const visibleOrgIds = new Set(rows.map((row) => row.id));

        const perfInput = {
          messages: (perfMessages.data ?? []).filter((m) => visibleOrgIds.has(m.organisation_id)),
          replies: (perfReplies.data ?? []).filter((r) => visibleOrgIds.has(r.organisation_id)),
          conversions: (perfConversions.data ?? []).filter((c) => visibleOrgIds.has(c.organisation_id)),
          // score_factors stays server-side for Priority Opportunities below:
          // the browser's Performance input keeps the LatestScoreRow shape, so
          // the serialised payload does not grow.
          scores: (perfScores.data ?? [])
            .filter((s) => visibleOrgIds.has(s.organisation_id))
            .map((s) => ({
              organisation_id: s.organisation_id,
              priority_band: s.priority_band,
              priority_score: s.priority_score,
              scored_at: s.scored_at,
            })),
          users: perfUsers.data ?? [],
        };
        scoresLoaded = true;
        const sectorByOrg = new Map(rows.map((row) => [row.id, row.sector ?? null]));
        performance = {
          summary: computePerformance(perfInput),
          trend: pipelineTrendSeries(perfInput),
          sectors: sectorPerformance(perfInput, sectorByOrg),
          queue: queueBands(perfInput.scores),
          // The funnel chart's three lines, bucketed server-side from the
          // year-long narrow reads. Same visible-org filter as the summary, so
          // suppressed clients stay out of both; empty on a funnel failure.
          funnel: funnelFailed
            ? { contacted: [], replied: [], converted: [] }
            : funnelTrendSeries({
                messages: (funnelMessages.data ?? []).filter((m) =>
                  visibleOrgIds.has(m.organisation_id),
                ),
                replies: (funnelReplies.data ?? []).filter((r) =>
                  visibleOrgIds.has(r.organisation_id),
                ),
                conversions: (funnelConversions.data ?? []).filter((c) =>
                  visibleOrgIds.has(c.organisation_id),
                ),
              }),
          // Owner-eligible roles: an active CAM or admin can own clients, so
          // both appear here — same list the clients owner filter uses.
          cams: perfUsers.data
            ?.filter((user) => user.role === "cam" || user.role === "admin")
            .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")) ?? [],
          // The section re-derives its tiles in the browser, so this crosses to
          // the client — trimmed to what it reads there (see the helper).
          ...performanceInputForClient(perfInput, sectorByOrg),
        };
      }

      // The org-name map is built from the visible rows only, which is also
      // how suppressed clients fall out of the feed: buildRecentUpdates drops
      // entries whose organisation has no name here.
      const orgNames = new Map(rows.map((row) => [row.id, row.legal_name]));

      const updateAuditRows = (rawUpdateAudit.data ?? []) as unknown as RecentAuditRow[];
      const updateNames = await auditNames;

      // Hover-card preview maps.
      //
      // Both are built from reads this page already does — the `users` and
      // `organisations` queries above now select the handful of extra columns the
      // cards need, rather than the maps being filled with placeholder nulls.
      const usersById = new Map((perfUsers.data ?? []).map((row) => [row.id, row]));

      // F058 band/score per organisation, off the `latest_scores` read the
      // queue-quality card already needs. `latest_scores` holds one row per org,
      // so no newest-wins reduction is required here.
      const scoreByOrg = new Map<string, { band: string | null; score: number | null }>(
        (perfScores.data ?? []).map((row) => [
          row.organisation_id,
          { band: row.priority_band, score: row.priority_score },
        ]),
      );

      // The duty queue's unassigned tile, narrowed to the clients an admin can
      // act on: no owner **and** the high band. The whole pool is thousands and
      // only rises, so counting it made the tile red on every load — and a
      // queue that is always red is one nobody reads. Band comes from the
      // stored `priority_band` rather than a re-cut threshold, the same way the
      // clients list's own high-score filter reads it, so the tile's number and
      // the list it links to cannot disagree.
      const unassignedHighPriorityCount = rows.filter(
        (row) => row.owner_id === null && scoreByOrg.get(row.id)?.band === "high",
      ).length;

      // "Your Priority Opportunities": this viewer's own book plus unclaimed
      // clients, ranked by score — who they should actually talk to next.
      // Gated on scoresLoaded (not just rows loading) so a failed scores read
      // hides the card instead of claiming there is nothing worth talking to.
      if (scoresLoaded) {
        const factorsByOrg = new Map(
          (perfScores.data ?? []).map((row) => [row.organisation_id, row.score_factors]),
        );
        priorityOpportunities = selectPriorityOpportunities(
          rows.map((row) => ({
            id: row.id,
            legal_name: row.legal_name,
            outreach_status: row.outreach_status,
            owner_id: row.owner_id,
            sector: row.sector ?? null,
            city: row.city ?? null,
            priority_score: scoreByOrg.get(row.id)?.score ?? null,
            priority_band: scoreByOrg.get(row.id)?.band ?? null,
            score_factors: factorsByOrg.get(row.id) ?? null,
            charity_activities: row.charity_activities ?? null,
            cic_community_statement: row.cic_community_statement ?? null,
          })),
          { ownerId: actor.id },
        );

        if (priorityOpportunities.length > 0) {
          // Missions for the ranked few only: one batched enrichment read for
          // the six ranked ids (the register-filed texts are already on the
          // rows). Fails soft — without it the cards still rank, they just
          // show no mission line.
          const { data: missionRows, error: missionError } = await supabase
            .from("enrichment_results")
            .select("organisation_id, mission_statement, enriched_at")
            .in(
              "organisation_id",
              priorityOpportunities.map((opportunity) => opportunity.id),
            )
            .order("enriched_at", { ascending: false })
            .overrideTypes<EnrichmentMissionRow[], { merge: false }>();
          if (missionError) {
            await reportError(missionError, { operation: "dashboard.opportunity_missions" });
          } else {
            const enrichmentMissions = newestMissionPerOrg(missionRows ?? []);
            priorityOpportunities = priorityOpportunities.map((opportunity) => ({
              ...opportunity,
              mission: resolveMissionText({
                charity_activities: opportunity.charity_activities ?? null,
                cic_community_statement: opportunity.cic_community_statement ?? null,
                enrichment_mission: enrichmentMissions.get(opportunity.id) ?? null,
              }),
            }));
          }
        }
      }

      // How many clients each CAM owns, counted once here rather than with a
      // `rows.find` per organisation (which was also looking up the wrong table).
      const ownedCountByUser = new Map<string, number>();
      for (const row of rows) {
        if (!row.owner_id) continue;
        ownedCountByUser.set(row.owner_id, (ownedCountByUser.get(row.owner_id) ?? 0) + 1);
      }

      const actorPreviewMap = new Map<string, ActorPreview>();
      for (const user of perfUsers.data ?? []) {
        const role =
          user.role === "leadership"
            ? "leadership"
            : user.role === "admin"
              ? "admin"
              : user.role === "viewer"
                ? "viewer"
                : "cam";

        const preview: ActorPreview = {
          id: user.id,
          fullName: user.full_name,
          email: user.email ?? "",
          role,
          ownedClientCount: ownedCountByUser.get(user.id) ?? 0,
          lastSeenAt: user.last_seen_at ?? null,
          isActive: user.is_active ?? true,
        };

        // Keyed by BOTH id and name: recent-updates and team-activity look actors
        // up by whichever they hold. Name-only keying also silently merged two
        // people who happen to share a name.
        actorPreviewMap.set(user.id, preview);
        if (user.full_name) actorPreviewMap.set(user.full_name, preview);
      }

      const orgPreviewMap = new Map<string, OrganisationPreview>();
      for (const row of rows) {
        // `owner_id` is a USER id. The previous lookup searched `rows` — the
        // organisations — for it and took that row's `legal_name`, so the owner
        // was always null, and would have shown a charity's name as the owner if
        // an id had ever matched.
        const owner = row.owner_id ? usersById.get(row.owner_id) : undefined;

        orgPreviewMap.set(row.id, {
          id: row.id,
          legalName: row.legal_name,
          organisationType: row.organisation_type ?? null,
          sector: row.sector ?? null,
          city: row.city ?? null,
          countryCode: row.country_code ?? null,
          outreachStatus: row.outreach_status,
          website: row.website ?? null,
          ownerId: row.owner_id,
          ownerName: owner?.full_name ?? null,
          ownerEmail: owner?.email ?? null,
          priorityBand: scoreByOrg.get(row.id)?.band ?? null,
          priorityScore: scoreByOrg.get(row.id)?.score ?? null,
        });
      }

      // Format team activities with preview data
      // Everyone's actions, the viewer's own included: they merge into Recent
      // updates, which already shows the viewer's own notes and emails, and a
      // feed that hid only some of your own activity would read as missing it.
      teamActivities = formatTeamActivities(
        (rawActivity.data ?? []) as RawTeamActivityRow[],
        null,
        new Date(),
        // ownedCounts — not read on this page; the previews are the 5th and 6th
        // parameters, and passing two placeholders here pushed them to 6th/7th.
        undefined,
        actorPreviewMap,
        orgPreviewMap,
      );

      recentUpdates = buildRecentUpdates(
        {
          notes: (rawUpdateNotes.data ?? []) as unknown as RecentNoteRow[],
          outreachMessages: (rawUpdateMessages.data ?? []) as unknown as RecentOutreachMessageRow[],
          replyEvents: (rawUpdateReplies.data ?? []) as unknown as RecentReplyEventRow[],
          auditRows: updateAuditRows,
        },
        orgNames,
        updateNames,
        new Date(),
        actorPreviewMap,
        orgPreviewMap,
      );

      if (adminReads) {
        // Started with every other read above, so the booklet read no longer
        // waits for the AI-cost read to finish first.
        const [queue, aiCosts, bookletCosts] = await adminReads;

        if (aiCosts.error) {
          await reportError(aiCosts.error, { operation: "dashboard.ai_spend" });
        }
        if (bookletCosts.error) {
          await reportError(bookletCosts.error, { operation: "dashboard.booklet_spend" });
        }
        if (!aiCosts.error && !bookletCosts.error) {
          aiSpend = aiSpendSummary([
            // The row's own classification: initial, regeneration and
            // follow-up are told apart by the column, not assumed.
            ...(aiCosts.data ?? []).map((row) => ({ ...row, activity: toAiGenerationActivity(row.activity) })),
            ...(bookletCosts.data ?? []).map((row) => ({ ...row, activity: "client_booklet" as const, total_tokens: row.total_tokens ?? ((row.input_tokens ?? 0) + (row.output_tokens ?? 0)) })),
          ], aiSpendNow);
        }

        if (queue.error) {
          // Reported rather than rendered as zeros: "0 ownership requests" and
          // "that query broke" look identical on screen, and only one of them
          // means the duty queue is clear.
          await reportError(queue.error, { operation: "dashboard.admin_queues" });
        }

        adminCounts = {
          ownershipRequests: queue.tally?.ownershipRequests ?? 0,
          pendingSuppressions: queue.tally?.pendingSuppressions ?? 0,
          suggestedEdits: queue.tally?.suggestedEdits ?? 0,
          discrepancies: queue.tally?.discrepancies ?? 0,
          statusChanges: queue.tally?.statusChanges ?? 0,
          unassignedHighPriorityOrgs: unassignedHighPriorityCount,
        };
      }

      if (threadStatesPromise) {
        const threadStatesResult = await threadStatesPromise;
        if (threadStatesResult.error) {
          await reportError(threadStatesResult.error, { operation: "dashboard.inbox_thread_state" });
        } else {
          const readOrgIds = new Set(
            (threadStatesResult.data ?? [])
              .filter((s) => s.read_state === "read")
              .map((s) => s.organisation_id),
          );
          unreadInboundOrgIds = new Set(
            respondedMineOrgIds.filter((id) => !readOrgIds.has(id)),
          );
        }
      }
    }
  }

  const replyTracking = summariseTrackedReplies(trackedReplies, rows);
  const metrics = computeDashboardMetrics(rows, replyTracking);
  // "Your actions": open actions overdue or due this week, and unsent drafts on
  // this person's own clients. Replies waiting and follow-ups due are not here
  // — the inbox's Inbound Replies and Follow-up Due tabs are their home. Both
  // reads fail soft: a failed one empties its half of the card, never the page.
  let myDesk: MyDesk | null = null;
  if (actionsRead && !loadFailed) {
    const myOrgNames = new Map(
      rows.filter((row) => row.owner_id === actor.id).map((row) => [row.id, row.legal_name]),
    );
    const [actionsResult, draftsResult] = await Promise.all([
      actionsRead,
      myOrgNames.size > 0
        ? supabase
            .from("outreach_messages")
            .select("id, organisation_id, subject, updated_at")
            .eq("send_status", "draft")
            .in("organisation_id", Array.from(myOrgNames.keys()))
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [] as DraftRow[], error: null }),
    ]);
    if (actionsResult.error) {
      await reportError(actionsResult.error, { operation: "dashboard.my_actions" });
    }
    if (draftsResult.error) {
      await reportError(draftsResult.error, { operation: "dashboard.my_drafts" });
    }

    const drafts: DeskDraft[] = ((draftsResult.data ?? []) as DraftRow[]).flatMap((draft) => {
      const organisationName = myOrgNames.get(draft.organisation_id);
      return organisationName
        ? [
            {
              id: draft.id,
              organisationId: draft.organisation_id,
              organisationName,
              subject: draft.subject,
              updatedAt: draft.updated_at,
            },
          ]
        : [];
    });

    myDesk = summariseMyDesk(
      formatMyActions((actionsResult.data ?? []) as unknown as ActionRow[], actor.id),
      drafts,
    );
  }

  // Null when any of the three counts failed: a capacity reading built on a
  // missing count would say "250 left" on a day the limit is already reached.
  let sendingCapacity: SendingCapacity | null = null;
  if (sendingCapacityRead) {
    const [limitResult, sentResult, scheduledResult] = await sendingCapacityRead;
    const failed = [limitResult, sentResult, scheduledResult].find((result) => result.error);
    if (failed?.error) {
      await reportError(failed.error, { operation: "dashboard.sending_capacity" });
    } else {
      sendingCapacity = {
        limit: limitResult.data?.daily_limit ?? DEFAULT_OUTREACH_DAILY_SEND_LIMIT,
        sentToday: sentResult.count ?? 0,
        scheduledToday: scheduledResult.count ?? 0,
      };
    }
  }
  // F022 — the total is now shown as a curve rather than a single number, so the
  // dashboard says how the pipeline got here, not only where it is. The series
  // runs back to the earliest record so "All time" is the whole story rather
  // than the last 30 days; the shorter presets slice the tail client-side.
  const growthDays = (() => {
    let earliest = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const created = Date.parse(row.created_at);
      if (!Number.isNaN(created)) earliest = Math.min(earliest, created);
    }
    if (earliest === Number.POSITIVE_INFINITY) return 30;
    return Math.max(30, Math.ceil((new Date().getTime() - earliest) / 86_400_000) + 1);
  })();
  const growth = organisationGrowthSeries(rows, growthDays);
  // Year-to-date preset: 1 January this year (UTC) with no end, so the slice
  // runs to today. Computed per request, so it rolls over on New Year's Day.
  const yearStartDay = `${new Date().getUTCFullYear()}-01-01`;

  // The meters read as a share of the whole pipeline, so an empty pipeline has to
  // draw an empty bar rather than divide by zero.
  const share = (value: number) =>
    metrics.totalCharities === 0 ? 0 : value / metrics.totalCharities;
  const shareCaption = (value: number) =>
    metrics.totalCharities === 0
      ? "No records yet"
      : `${Math.round(share(value) * 100)}% of the pipeline`;

  // F206 — this actor's own desk, off the rows already loaded. The strip is
  // suppressed entirely for an actor who owns nothing (a viewer, or a CAM on
  // day one): four zeros teach nothing, and the first-run guide is the thing
  // that should be talking to a CAM with no clients.
  const myWork: MyWorkSummary | null = (() => {
    if (loadFailed || !canViewClients) return null;
    const summary = myWorkSummary(rows, actor.id, { unreadOrgIds: unreadInboundOrgIds });
    return summary.owned > 0 ? summary : null;
  })();

  // F255 — the first-run guide. Read both halves of its state together: whether this
  // CAM is still eligible for it (users) and how far through they are
  // (user_onboarding_steps). A failure to read either is not worth failing the
  // dashboard over — the guide simply doesn't render, and the CAM sees the normal
  // screen rather than an error about a checklist.
  let guide: ReturnType<typeof guideProgress> | null = null;
  let ownsAnyClient = false;

  if (actor.role === "cam") {
    const { profile, steps: completedSteps } = await viewerState;

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
      const { data: userProfile } = (await viewerState).profile;

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

  const leaderboard =
    performance && seesAdminView(actor.role)
      ? camLeaderboard(performance.summary, performance.cams)
      : null;

  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="mx-auto w-full max-w-[1400px] space-y-10">
        <Rise className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              Dashboard
            </h1>
            
          </div>

          {canViewClients && (
            <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
              {/* The one accent on the screen: a single pill, glass backdrop + lime hover fill, pointing at
                  the screen where the work actually happens. */}
              <OriginButton
                href="/clients"
                size="md"
                className="shrink-0"
              >
                View all clients
              </OriginButton>
            </div>
          )}
        </Rise>

        {error === "admin-access-required" && (
          <Rise>
            <InlineAlert variant="page" message="That page is restricted to administrators." />
          </Rise>
        )}

        {!canWrite && (
          <Rise>
            <section className="rounded-panel border border-rule bg-white px-5 py-4">
              <h2 className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                You have view-only access
              </h2>
              <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
                You can open every page an admin can, including team analytics, approvals
                and the audit log. Nothing you press will change a client, import data or
                send an email — if you try, we&rsquo;ll tell you, and nothing is saved.
              </p>
            </section>
          </Rise>
        )}

        {/* Sending health. The inbox owns the full three-check status card; this
            speaks only when a check is not reporting active, because until now
            silence here meant both "the engine is running" and "reply sync died
            on Friday". */}
        {engineHealthPromise && (
          <Suspense fallback={null}>
            <EngineHealthBanner health={engineHealthPromise} />
          </Suspense>
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
            {/* F206 — the CAM's own work comes before the platform totals. The
                totals are the right numbers for a standup and the wrong ones for
                the person who just logged in: nobody acts on "1,794
                organisations". */}
            {myWork ? (
              <Group className="space-y-4">

                <Rise>
                  <MyWorkStrip summary={myWork} actorId={actor.id} />
                </Rise>
              </Group>
            ) : (
              /* A CAM whose book is empty got no strip and no explanation: the
                 page started at platform totals and never mentioned them, so
                 handing on your last client left the dashboard with nothing to
                 say. CAMs only — a viewer cannot own a client, and an admin
                 reads the same pool under their own duty queue. */
              actor.role === "cam" &&
              canWrite && (
                <Rise>
                  <section className="rounded-panel border border-rule bg-white px-5 py-4">
                    <h2 className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                      Nothing on your desk
                    </h2>
                    <p className="mt-1 max-w-[54ch] font-body text-[13px] leading-[1.55] text-dim">
                      {unassignedCount > 0
                        ? `${unassignedCount.toLocaleString()} ${unassignedCount === 1 ? "client has" : "clients have"} no owner yet. Claim one and the work appears here.`
                        : "You do not own a client yet. Browse the pipeline and claim one to start."}
                    </p>
                    <div className="mt-3">
                      <OriginButton
                        href={unassignedCount > 0 ? "/clients?owner=unassigned" : "/clients"}
                        size="md"
                      >
                        {unassignedCount > 0 ? "Find unassigned clients" : "Browse clients"}
                      </OriginButton>
                    </div>
                  </section>
                </Rise>
              )
            )}

            {/* Admin duty queue beside today's branch-wide sending limit. */}
            {(adminCounts || sendingCapacity) && (
              <Group className="space-y-4">
                <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-3">
                  {adminCounts && (
                    <Rise className="h-full xl:col-span-2">
                      <AdminActionCenter counts={adminCounts} />
                    </Rise>
                  )}
                  {sendingCapacity && (
                    <Rise className={`h-full ${!adminCounts ? "xl:col-span-3" : ""}`}>
                      <SendingCapacityCard
                        capacity={sendingCapacity}
                        canChangeLimit={actor.role === "admin"}
                      />
                    </Rise>
                  )}
                </div>
              </Group>
            )}

            <Group className="space-y-4">
              {/* Side-by-side row: Total Organisations curve + Customer Segmentation dial */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 items-stretch">
                <div className="relative z-20 flex flex-col xl:col-span-8">
                  <Rise glass className="h-full flex-1">
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
                        { label: "Past 30 days", points: 30 },
                        { label: "Last 3 months", points: 90 },
                        { label: "Year to date", from: yearStartDay },
                        { label: "Last 12 months", points: 365 },
                        { label: "All time" },
                      ]}
                      allowCustomRange
                      showFooter={false}
                      className="relative z-20 h-full rounded-2xl border-black/[0.06] shadow-sm"
                    />
                  </Rise>
                </div>
                <div className="relative z-10 flex flex-col xl:col-span-4">
                  <Rise className="h-full flex-1">
                    {performance ? (
                      <QueueQualityCard
                        bands={performance.queue.bands}
                        scored={performance.queue.scored}
                        totalOrgs={metrics.totalCharities}
                        className="h-full rounded-2xl border-black/[0.06] shadow-sm"
                      />
                    ) : (
                      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-1 rounded-[28px] border border-border bg-card p-6 text-center shadow-sm">
                        <p className="text-sm font-medium text-foreground">Queue data unavailable</p>
                        <p className="text-xs text-muted-foreground">
                          The scoring bands could not be loaded. Refresh and try again.
                        </p>
                      </div>
                    )}
                  </Rise>
                </div>
              </div>

              {/* What the totals above are missing, and why. F022 AC3 drops
                  actively-suppressed clients from every number in this group,
                  which is right — but the screen said nothing about it, so a
                  suppression landing quietly shrank the pipeline and only the
                  admin who approved it could explain why. */}
              {suppressedCount > 0 && (
                <Rise>
                  <p className="font-body text-[12.5px] leading-[1.55] text-dim">
                    {suppressedCount.toLocaleString()} suppressed{" "}
                    {suppressedCount === 1 ? "client" : "clients"} excluded from totals (active
                    suppressions).
                  </p>
                </Rise>
              )}

              {/* Contacted / responded / converted as counts, under the curve
                  they break down. Kept beside the new segmentation dial rather
                  than dropped with the old single-column layout: the response
                  card is the only place the average turnaround is read. */}
              {(() => {
                const dashNow = new Date();
                const todayUtc = Date.UTC(dashNow.getUTCFullYear(), dashNow.getUTCMonth(), dashNow.getUTCDate());
                const trailing7StartUtc = todayUtc - 6 * 24 * 60 * 60 * 1000;
                const trailing7EndUtc = todayUtc + 24 * 60 * 60 * 1000;

                const countTrailing7Days = (timestamps: (string | null | undefined)[]) => {
                  const counts = [0, 0, 0, 0, 0, 0, 0];
                  for (const ts of timestamps) {
                    if (!ts) continue;
                    const ms = Date.parse(ts);
                    if (Number.isNaN(ms) || ms < trailing7StartUtc || ms >= trailing7EndUtc) continue;
                    const dayIdx = Math.floor((ms - trailing7StartUtc) / (24 * 60 * 60 * 1000));
                    if (dayIdx >= 0 && dayIdx < 7) {
                      counts[dayIdx] += 1;
                    }
                  }
                  return counts;
                };

                const contactedDaily = performance?.raw
                  ? countTrailing7Days(performance.raw.messages.map((m) => m.sent_at))
                  : undefined;
                const repliesDaily = performance?.raw
                  ? countTrailing7Days(performance.raw.replies.map((r) => r.received_at))
                  : undefined;
                const convertedDaily = performance?.raw
                  ? countTrailing7Days(performance.raw.conversions.map((c) => c.created_at))
                  : undefined;

                return (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <Rise className="relative hover:z-30 focus-within:z-30">
                      <StatCard
                        label="Contacted"
                        value={metrics.contacted}
                        share={share(metrics.contacted)}
                        caption={shareCaption(metrics.contacted)}
                        data={contactedDaily}
                        total={metrics.totalCharities}
                        checked={metrics.contacted}
                      />
                    </Rise>
                    <Rise className="relative hover:z-30 focus-within:z-30">
                      <StatCard
                        label="Responses received"
                        value={metrics.responsesReceived}
                        share={share(metrics.respondingClients)}
                        showGauge={false}
                        data={repliesDaily}
                        footerBadge={
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-lead/8 px-2.5 py-0.5 text-[11px] font-semibold text-lead dark:bg-lead/15">
                            <span className="h-1.5 w-1.5 rounded-full bg-lead" />
                            <span>Avg turnaround · {formatResponseTime(replyTracking.averageResponseTimeSeconds)}</span>
                          </span>
                        }
                        caption={`${metrics.respondingClients.toLocaleString()} responding ${metrics.respondingClients === 1 ? "client" : "clients"}`}
                      />
                    </Rise>
                    <Rise className="relative hover:z-30 focus-within:z-30">
                      <StatCard
                        label="Converted"
                        value={metrics.converted}
                        share={share(metrics.converted)}
                        caption={shareCaption(metrics.converted)}
                        data={convertedDaily}
                        total={metrics.totalCharities}
                        checked={metrics.converted}
                        emphasis
                      />
                    </Rise>
                  </div>
                );
              })()}
            </Group>

            {performance && (
              <Group className="space-y-4">
                <Rise>
                  <PerformanceSection
                    summary={performance.summary}
                    cams={performance.cams}
                    actorId={actor.id}
                    actorRole={actor.role}
                    trend={performance.trend}
                    funnel={performance.funnel}
                    sectors={performance.sectors}
                    raw={performance.raw}
                    sectorByOrg={performance.sectorByOrg}
                    showLeaderboard={false}
                  />
                </Rise>
              </Group>
            )}

            {/* Your Priority Opportunities — the ranked SCOUT shortlist that says
                who to actually talk to next, not the average score. Personal
                scope (own book plus unclaimed clients), off the scores already
                loaded above. A CAM with nothing ranked yet sees the card's
                empty state rather than silence. */}
            {scoresLoaded &&
              (priorityOpportunities.length > 0 || (actor.role === "cam" && canWrite)) && (
                <Group className="space-y-4">
                  <Rise>
                    <PriorityOpportunitiesCard opportunities={priorityOpportunities} />
                  </Rise>
                </Group>
              )}

            {/* F212 (#207) — Manager Analytics: CAM comparison table */}
            {leaderboard && (
              <Group className="space-y-4">
                <Rise>
                  <CamLeaderboardTable board={leaderboard} className="mt-0" />
                </Rise>
              </Group>
            )}

            {/* Work with a date on it and drafts left unsent, beside AI spend summary for admins. */}
            {(myDesk || (seesAdminView(actor.role) && aiSpend)) && (
              <Group className="space-y-4">
                <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
                  {myDesk && (
                    <Rise className={`h-full ${seesAdminView(actor.role) && aiSpend ? "xl:col-span-2" : "xl:col-span-3"}`}>
                      <MyActionsCard desk={myDesk} />
                    </Rise>
                  )}
                  {seesAdminView(actor.role) && aiSpend && (
                    <Rise className={`h-full ${!myDesk ? "xl:col-span-1" : ""}`}>
                      <AiSpendCard summary={aiSpend} />
                    </Rise>
                  )}
                </div>
              </Group>
            )}

            {/* F028/F029 — what changed on clients and what the team did, as one
                feed. They were two cards that both reported pipeline and
                ownership moves; the merge drops the second copy. */}
            <Group className="space-y-4">
              <Rise>
                <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">Recent updates</h2>
              </Rise>

              <Rise>
                <RecentUpdatesFeed items={mergeDashboardFeed(recentUpdates, teamActivities)} />
              </Rise>
            </Group>

            {/* Is the data in good shape, and is the machinery behind it running.
                Streamed: the rest of the dashboard never waits for these. */}
            {healthReads && orgHealthFacts && (
              <Suspense fallback={null}>
                <HealthCards reads={healthReads} orgFacts={orgHealthFacts} />
              </Suspense>
            )}
          </>
        )}
      </Stage>
      {showFeedback && <FeedbackPrompt pageContext="/dashboard" />}
    </div>
  );
}
