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
  type GrowthPoint,
  type OpenSuppression,
} from "@/lib/dashboard-metrics";
import {
  computePerformance,
  pipelineTrendSeries,
  queueBands,
  sectorPerformance,
  trendWindowStart,
  type ConvertedOutcomeRow,
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
import { followUpRecommendations, DEFAULT_FOLLOW_UP_THRESHOLDS, type FollowUpRecommendation } from "@/lib/outreach/follow-up-recommendations";
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
import { replyQueueSummary, type ReplyQueueSummary } from "@/lib/dashboard/reply-queue";
import { aiSpendSummary, type AiGenerationCostRow, type AiSpendSummary } from "@/lib/dashboard/ai-spend";
import type { ConversionRow } from "@/lib/dashboard/conversions-over-time";
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import { AttentionList } from "@/components/attention-list";
import { TeamActivityFeed } from "@/components/team-activity-feed";
import { RecentUpdatesFeed } from "@/components/recent-updates-feed";
import { FirstRunGuide } from "@/components/first-run-guide";
import { OriginButton } from "@/components/ui/origin-button";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { AdminActionCenter, type AdminQueueCounts } from "@/components/dashboard/admin-action-center";
import { QueueQualityCard } from "@/components/dashboard/queue-quality-card";
import { PerformanceSection } from "@/components/dashboard/performance-section";
import { MyWorkStrip } from "@/components/dashboard/my-work-strip";
import { FollowUpsDueCard } from "@/components/dashboard/follow-ups-due-card";
import { ReplyQueueCard } from "@/components/dashboard/reply-queue-card";
import { ConversionsOverTimeCard } from "@/components/dashboard/conversions-over-time-card";
import { AiSpendCard } from "@/components/dashboard/ai-spend-card";
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
  searchParams: Promise<{ error?: string; preview_feedback?: string }>;
}) {
  const { error, preview_feedback } = await searchParams;
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
  let recentUpdates: FormattedRecentUpdate[] = [];
  let adminCounts: AdminQueueCounts | null = null;
  let loadFailed = false;

  // F210 — its own 12-month window, wider than the Performance section's 90
  // days, because progress against a target is a this-quarter / trailing-year
  // question. Null when the read fails: the card simply doesn't render.
  let conversionHistory: ConversionRow[] | null = null;
  // F213 — admin-only month-to-date AI spend, plus the equal-length prior
  // stretch it is compared against.
  let aiSpend: AiSpendSummary | null = null;
  // The reply queue (clients whose newest event is their reply) is derived from
  // the Performance section's already-fetched message and reply rows, so it
  // costs no extra query — and is therefore null exactly when that read failed.
  let replyQueue: ReplyQueueSummary | null = null;

  // Performance section state — null when its reads fail, so the rest of the
  // dashboard still renders (every section here fails independently).
  let performance: {
    summary: PerformanceSummary;
    trend: GrowthPoint[];
    sectors: SectorPerformanceRow[];
    queue: { bands: QueueBands; scored: number };
    cams: TeamUserRow[];
    raw: PerformanceInput;
    sectorByOrg: Map<string, string | null>;
  } | null = null;

  if (canViewClients) {
    const supabase = await createClient();
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
    async function fetchAllOrganisations(): Promise<{
      data: DashboardOrgRow[] | null;
      error: { message: string } | null;
    }> {
      const all: DashboardOrgRow[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await        supabase
          .from("organisations")
          .select(
            "id, legal_name, outreach_status, owner_id, updated_at, created_at, sector, organisation_type, city, country_code, website",
          )
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + step - 1)
          .overrideTypes<DashboardOrgRow[], { merge: false }>();
        if (error) return { data: null, error };
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < step) break;
        from += step;
      }
      return { data: all, error: null };
    }

    async function fetchAllOpenSuppressions(): Promise<{
      data: OpenSuppression[] | null;
      error: { message: string } | null;
    }> {
      const all: OpenSuppression[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("suppressions")
          .select("organisation_id, status")
          .in("status", ["pending", "active"])
          .order("organisation_id", { ascending: true })
          .range(from, from + step - 1)
          .overrideTypes<OpenSuppression[], { merge: false }>();
        if (error) return { data: null, error };
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < step) break;
        from += step;
      }
      return { data: all, error: null };
    }

    // The Performance section reads four event/score tables over a window; the
    // same PostgREST 1000-row cap applies to each, so every one paginates the
    // same way the organisations fetch above does.
    async function fetchAllRows<T>(
      buildPage: (
        from: number,
        to: number,
      ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    ): Promise<{ data: T[] | null; error: { message: string } | null }> {
      const all: T[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await buildPage(from, from + step - 1);
        if (error) return { data: null, error };
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < step) break;
        from += step;
      }
      return { data: all, error: null };
    }

    const [organisations, openSuppressions, rawActivity, rawUpdateNotes, rawUpdateMessages, rawUpdateReplies, rawUpdateAudit] =
      await Promise.all([
        fetchAllOrganisations(),
        fetchAllOpenSuppressions(),
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
        supabase
          .from("audit_log")
          .select("id, actor_user_id, action, detail, created_at, target_id")
          .eq("target_table", "organisations")
          .in("action", ["status_changed", "ownership_reassigned"])
          .gte("created_at", updateCutoff)
          .order("created_at", { ascending: false })
          .limit(RECENT_UPDATES_SOURCE_FETCH_CAP),
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

      // Performance section — one 90-day window, five reads. Every table here
      // is readable by every role (matrix §3.1, §3.4, §3.6), so this is not an
      // admin-only view; the section itself decides who may pick which CAM.
      // Same ISO-string discipline as updateCutoff above: postgrest-js
      // interpolates filter values raw, so a Date would 400 every query.
      const perfCutoff = trendWindowStart(new Date()).toISOString();

      // F210 reads the same `outcomes` table as the Performance section but over
      // a 12-month window rather than 90 days, so it gets its own cutoff. Start
      // of the month 11 months back, matching `conversionRanges`' widest option
      // — fetching to the day would leave the first monthly bucket partial.
      const conversionWindowStart = (() => {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString();
      })();

      const [perfMessages, perfReplies, perfConversions, perfScores, perfUsers, conversionYear] = await Promise.all([
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
        // before the window still belongs to the queue.
        fetchAllRows<LatestScoreRow>((from, to) =>
          supabase
            .from("latest_scores")
            .select("organisation_id, priority_band, priority_score, scored_at")
            .order("organisation_id", { ascending: true })
            .range(from, to)
            .overrideTypes<LatestScoreRow[], { merge: false }>(),
        ),
        fetchAllRows<TeamUserRow>((from, to) =>
          supabase
            .from("users")
            .select("id, full_name, role, email, last_seen_at, is_active")
            .order("full_name", { ascending: true })
            .range(from, to)
            .overrideTypes<TeamUserRow[], { merge: false }>(),
        ),
        fetchAllRows<ConversionRow>((from, to) =>
          supabase
            .from("outcomes")
            .select("created_at, recorded_by_user_id, organisation_id")
            .eq("outcome_type", "converted")
            .gte("created_at", conversionWindowStart)
            .order("created_at", { ascending: true })
            .range(from, to)
            .overrideTypes<ConversionRow[], { merge: false }>(),
        ),
      ]);

      // F210 fails on its own, like every other section: a failed 12-month read
      // hides that one card and leaves the 90-day Performance numbers standing.
      if (conversionYear.error) {
        await reportError(conversionYear.error, { operation: "dashboard.conversions_over_time" });
      } else {
        const visible = new Set(rows.map((row) => row.id));
        conversionHistory = (conversionYear.data ?? []).filter((row) =>
          visible.has(row.organisation_id),
        );
      }

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

      if (!perfFailed) {
        const visibleOrgIds = new Set(rows.map((row) => row.id));

        const perfInput = {
          messages: (perfMessages.data ?? []).filter((m) => visibleOrgIds.has(m.organisation_id)),
          replies: (perfReplies.data ?? []).filter((r) => visibleOrgIds.has(r.organisation_id)),
          conversions: (perfConversions.data ?? []).filter((c) => visibleOrgIds.has(c.organisation_id)),
          scores: (perfScores.data ?? []).filter((s) => visibleOrgIds.has(s.organisation_id)),
          users: perfUsers.data ?? [],
        };
        const sectorByOrg = new Map(rows.map((row) => [row.id, row.sector ?? null]));
        performance = {
          summary: computePerformance(perfInput),
          trend: pipelineTrendSeries(perfInput),
          sectors: sectorPerformance(perfInput, sectorByOrg),
          queue: queueBands(perfInput.scores),
          cams: perfUsers.data
            ?.filter((user) => user.role === "cam")
            .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")) ?? [],
          raw: perfInput,
          sectorByOrg,
        };

        // The reply queue rides on the same rows — no extra read. It needs
        // owners, which `perfInput` doesn't carry, so it takes `rows` directly.
        replyQueue = replyQueueSummary(
          perfInput.messages,
          perfInput.replies,
          rows.map((row) => ({ id: row.id, legal_name: row.legal_name, owner_id: row.owner_id })),
          actor.id,
        );
      }

      // The org-name map is built from the visible rows only, which is also
      // how suppressed clients fall out of the feed: buildRecentUpdates drops
      // entries whose organisation has no name here.
      const orgNames = new Map(rows.map((row) => [row.id, row.legal_name]));

      // audit_log's actor_user_id and detail.from/detail.to are bare uuids
      // (jsonb, not an FK PostgREST can embed), resolved in one batch — same
      // approach as the client timeline page.
      const updateAuditRows = (rawUpdateAudit.data ?? []) as unknown as RecentAuditRow[];
      const referencedUserIds = new Set<string>();
      for (const row of updateAuditRows) {
        if (row.actor_user_id) referencedUserIds.add(row.actor_user_id);
        const detail =
          row.detail && typeof row.detail === "object"
            ? (row.detail as Record<string, unknown>)
            : {};
        if (typeof detail.from === "string") referencedUserIds.add(detail.from);
        if (typeof detail.to === "string") referencedUserIds.add(detail.to);
      }

      const updateNames = new Map<string, string | null>();
      if (referencedUserIds.size > 0) {
        const { data: referencedUsers } = await supabase
          .from("users")
          .select("id, full_name")
          .in("id", Array.from(referencedUserIds));
        for (const row of referencedUsers ?? []) {
          updateNames.set(row.id, row.full_name);
        }
      }

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
      teamActivities = formatTeamActivities(
        (rawActivity.data ?? []) as RawTeamActivityRow[],
        actor.id,
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

      if (actor.role === "admin") {
        // F213 — month-to-date spend needs the current month plus the equal-length
        // stretch before it, so the window reaches back two months and
        // `aiSpendSummary` splits it. Every role can read AI_GENERATIONS (§3.4),
        // but the budget is an admin concern, so the read is scoped to this block
        // rather than the tile being hidden client-side.
        const aiWindowStart = (() => {
          const now = new Date();
          return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
        })();

        const [ownershipReqs, suppressions, edits, discrepancies, aiCosts] = await Promise.all([
          supabase.from("ownership_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("suppressions").select("id", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("edit_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("field_discrepancies").select("id", { count: "exact", head: true }).eq("status", "pending"),
          fetchAllRows<AiGenerationCostRow & { outreach_message_id: string | null }>((from, to) =>
          supabase
            .from("ai_generations")
            .select("created_at, cost_usd, total_tokens, model, outreach_message_id")
              .gte("created_at", aiWindowStart)
              .order("created_at", { ascending: true })
              .range(from, to)
              .overrideTypes<(AiGenerationCostRow & { outreach_message_id: string | null })[], { merge: false }>(),
          ),
        ]);

        if (aiCosts.error) {
          await reportError(aiCosts.error, { operation: "dashboard.ai_spend" });
        } else {
          const messageIds = (aiCosts.data ?? [])
            .map((row) => row.outreach_message_id)
            .filter((id): id is string => Boolean(id));
          const { data: linkedMessages } = messageIds.length
            ? await supabase.from("outreach_messages").select("id, created_at, organisation_id").in("id", messageIds)
            : { data: [] as { id: string; created_at: string; organisation_id: string }[] };
          const messageDates = new Map((linkedMessages ?? []).map((row) => [row.id, row.created_at]));
          const { data: booklets } = await supabase
            .from("booklet_generations")
            .select("created_at, cost_usd, total_tokens, model, input_tokens, output_tokens")
            .gte("created_at", aiWindowStart);
          aiSpend = aiSpendSummary([
            ...(aiCosts.data ?? []).map((row) => ({
              ...row,
              // `as const` or this widens to `string` and stops matching
              // AiGenerationActivity — the booklet branch below already has it.
              activity: "initial_email" as const,
            })),
            ...(booklets ?? []).map((row) => ({ ...row, activity: "client_booklet" as const, total_tokens: row.total_tokens ?? ((row.input_tokens ?? 0) + (row.output_tokens ?? 0)) })),
          ]);
        }

        const unassignedOrgs = rows.filter(r => r.owner_id === null).length;

        adminCounts = {
          ownershipRequests: ownershipReqs.count ?? 0,
          pendingSuppressions: suppressions.count ?? 0,
          suggestedEdits: edits.count ?? 0,
          discrepancies: discrepancies.count ?? 0,
          unassignedOrgs,
        };
      }
    }
  }

  const metrics = computeDashboardMetrics(rows);
  // F160 — silence is measured from the client's last real activity (latest of
  // sent email, received reply, audited status change), aggregated per client by
  // get_clients_last_activity; the thresholds are this CAM's own preferences
  // (defaults 7/14). Both reads fail soft: a failed activity query degrades the
  // panel back to its pre-F160 status-only list rather than hiding it.
  let attentionItems = needsAttention(rows, actor.id);
  // F160/F161 — the recommendations are now rendered as their own card
  // (Follow-ups due) as well as decorating the Needs Attention rows, so they are
  // hoisted out of the block that computes them.
  //
  // The `attentionItems.length > 0` guard below still holds for both readers:
  // `NEEDS_ATTENTION_STATUSES` and `FOLLOW_UP_TRIGGER_STATUSES` are the same
  // three statuses, so an empty attention list means there is nothing that could
  // become a recommendation either, and skipping the two reads is correct rather
  // than merely convenient.
  let followUps: FollowUpRecommendation[] = [];
  if (!loadFailed && attentionItems.length > 0) {
    const supabase = await createClient();
    const myClients = rows
      .filter((row) => row.owner_id === actor.id)
      .map((row) => ({ id: row.id, legal_name: row.legal_name, outreach_status: row.outreach_status }));
    if (myClients.length > 0) {
      const [preferences, activity] = await Promise.all([
        supabase
          .from("outreach_preferences")
          .select("first_follow_up_days, second_follow_up_days")
          .eq("user_id", actor.id)
          .maybeSingle(),
        supabase.rpc("get_clients_last_activity", {
          p_organisation_ids: myClients.map((row) => row.id),
        }),
      ]);
      if (activity.error) {
        await reportError(activity.error, { operation: "dashboard.follow_up_activity" });
      }
      if (preferences.error) {
        await reportError(preferences.error, { operation: "dashboard.follow_up_preferences" });
      }

      const recommendations: FollowUpRecommendation[] = followUpRecommendations(
        myClients,
        new Map(
          (activity.data ?? []).map(
            (row: {
              organisation_id: string;
              last_email_sent_at: string | null;
              last_reply_received_at: string | null;
              last_status_change_at: string | null;
            }) => [
              row.organisation_id,
              {
                lastEmailSentAt: row.last_email_sent_at,
                lastReplyReceivedAt: row.last_reply_received_at,
                lastStatusChangeAt: row.last_status_change_at,
              },
            ],
          ),
        ),
        {
          first: preferences.data?.first_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.first,
          second: preferences.data?.second_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.second,
        },
      );
      followUps = recommendations;
      const byOrganisation = new Map(recommendations.map((rec) => [rec.organisationId, rec]));
      attentionItems = attentionItems.map((item) => {
        const rec = byOrganisation.get(item.id);
        return rec
          ? { ...item, followUp: { daysWaiting: rec.daysWaiting, urgency: rec.urgency } }
          : item;
      });
    }
  }
  // F022 — the total is now shown as a curve rather than a single number, so the
  // dashboard says how the pipeline got here, not only where it is.
  const growth = organisationGrowthSeries(rows);

  // F206 — this actor's own desk, off the rows already loaded. The strip is
  // suppressed entirely for an actor who owns nothing (a viewer, or a CAM on
  // day one): four zeros teach nothing, and the first-run guide is the thing
  // that should be talking to a CAM with no clients.
  const myWork: MyWorkSummary | null = (() => {
    if (loadFailed || !canViewClients) return null;
    const summary = myWorkSummary(rows, actor.id);
    return summary.owned > 0 ? summary : null;
  })();

  // The reply queue is shown when this actor has replies of their own waiting,
  // and additionally to an admin when the *team* has some — an admin who owns no
  // clients still needs to know that twelve replies are going unanswered.
  const showReplyQueue =
    replyQueue !== null &&
    (replyQueue.mine > 0 || (actor.role === "admin" && replyQueue.team > 0));

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
    <div className="min-h-screen bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="mx-auto w-full max-w-[1400px] space-y-10">
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
            {/* F206 — the CAM's own work comes before the platform totals. The
                totals are the right numbers for a standup and the wrong ones for
                the person who just logged in: nobody acts on "1,794
                organisations". */}
            {myWork && (
              <Group className="space-y-4">
                <Rise className="flex items-baseline justify-between gap-4">
                  <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">My work</h2>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                    Yours · right now
                  </p>
                </Rise>

                <Rise>
                  <MyWorkStrip summary={myWork} actorId={actor.id} />
                </Rise>
              </Group>
            )}

            {/* F160/F161 and the reply queue: the two lists that are actually a
                queue of work, side by side, above everything that is a reading
                rather than a task. Either card renders alone if the other has
                nothing to say — a CAM with no clients yet gets neither. */}
            {(followUps.length > 0 || showReplyQueue) && (
              <Group className="space-y-4">
                <Rise className="flex items-baseline justify-between gap-4">
                  <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">
                    Waiting on you
                  </h2>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                    Yours · most pressing first
                  </p>
                </Rise>

                <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
                  {followUps.length > 0 && (
                    <Rise className="h-full">
                      <FollowUpsDueCard recommendations={followUps} actorId={actor.id} />
                    </Rise>
                  )}
                  {showReplyQueue && replyQueue && (
                    <Rise className="h-full">
                      <ReplyQueueCard summary={replyQueue} isAdmin={actor.role === "admin"} />
                    </Rise>
                  )}
                </div>
              </Group>
            )}

            <Group className="space-y-4">

              {/* Side-by-side row: Total Organisations curve + Customer Segmentation dial */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 items-stretch">
                <div className="relative z-20 flex flex-col xl:col-span-8">
                  <Rise className="h-full flex-1">
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
                    sectors={performance.sectors}
                    raw={performance.raw}
                    sectorByOrg={performance.sectorByOrg}
                  />
                </Rise>
              </Group>
            )}

            {/* F210 — conversions as a COUNT, next to (not instead of) the
                conversion-rate curve inside Performance above. Halve the
                outreach and the rate holds steady while this halves; a manager
                needs to see that, so both readings stay on the page. */}
            {conversionHistory && (
              <Group className="space-y-4">
                <Rise className="flex items-baseline justify-between gap-4">
                  <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">
                    Conversions over time
                  </h2>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                    The team · how many, not how well
                  </p>
                </Rise>

                <Rise>
                  <ConversionsOverTimeCard conversions={conversionHistory} />
                </Rise>
              </Group>
            )}

            {attentionItems.length > 0 && (
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
            )}

            {actor.role === "admin" && (adminCounts || aiSpend) && (
              <Group className="space-y-4">
                {/* The admin queues and the spend they generate, in one row:
                    F213's number had no home on the platform, and the budget is
                    an admin reading like everything else here. */}
                <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
                  {adminCounts && (
                    <Rise className="h-full xl:col-span-2">
                      <AdminActionCenter counts={adminCounts} />
                    </Rise>
                  )}
                  {aiSpend && (
                    <Rise className="h-full">
                      <AiSpendCard summary={aiSpend} />
                    </Rise>
                  )}
                </div>
              </Group>
            )}

            {/* F028 — what changed across the platform, above who did it. */}
            <Group className="space-y-4">
              <Rise className="flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">Recent updates</h2>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                  All clients · past 14 days
                </p>
              </Rise>

              <Rise>
                <RecentUpdatesFeed items={recentUpdates} />
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
      {showFeedback && <FeedbackPrompt pageContext="/dashboard" />}
    </div>
  );
}
