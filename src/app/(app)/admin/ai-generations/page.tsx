import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import {
  groupByDay,
  groupByModel,
  type GenerationMetric,
  type GenerationRecord,
} from "@/lib/outreach/generation-history";
import {
  DEFAULT_GENERATION_PAGE_SIZE,
  GENERATION_CLIENT_MATCH_LIMIT,
  GENERATION_MESSAGE_MATCH_LIMIT,
  GENERATION_PAGE_SIZES,
  cleanSearchTerm,
  describeGenerationFilters,
  generationSearchOrExpression,
  generationSearchPattern,
  parseEdited,
  parseGenerationPage,
  parseModels,
} from "@/lib/outreach/generation-search";
import { pagingIsUseful } from "@/lib/pagination";
import { Group, Rise } from "@/components/dashboard-stage";
import { SearchRail } from "@/components/search-rail";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Key, Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { AiHeader } from "../ai-header";
import { ModelBreakdown } from "./model-breakdown";
import { ModelFilterSelect } from "./model-filter-select";
import { SpendOverTime } from "./spend-over-time";
import { HistoryPageSize, HistoryPagingSummary } from "./history-pager";

// Next.js 16: searchParams is a Promise on App Router pages — same pattern as
// src/app/(app)/clients/page.tsx.
type SearchParams = Promise<{
  model?: string | string[];
  metric?: string;
  client?: string;
  q?: string;
  edited?: string;
  sentBy?: string;
  page?: string;
  pageSize?: string;
}>;

/**
 * The columns the charts read. Deliberately not the prompt/output text: the
 * charts need every row in scope, and every row in scope used to mean every
 * prompt ever written, downloaded on each visit.
 */
type ChartRow = {
  model: string;
  created_at: string;
  total_tokens: number | null;
  cost_usd: number | null;
};

/** One row of the visible page — the heavy text is fetched only for these. */
type GenerationRow = {
  id: string;
  model: string;
  generated_subject: string | null;
  generated_body: string | null;
  prompt_system: string;
  prompt_user: string;
  cam_edited: boolean;
  created_at: string;
  total_tokens: number | null;
  cost_usd: number | null;
  outreach_message: {
    organisation_id: string;
    organisation: { legal_name: string } | null;
    sent_by: { full_name: string | null } | null;
  } | null;
};

const GENERATION_ROW_COLUMNS =
  "id, model, generated_subject, generated_body, prompt_system, prompt_user, cam_edited, created_at, total_tokens, cost_usd, outreach_message:outreach_messages(organisation_id, organisation:organisations(legal_name), sent_by:users(full_name))";

const METRICS: readonly GenerationMetric[] = ["count", "tokens", "cost"];
const METRIC_LABEL: Record<GenerationMetric, string> = {
  count: "Generations",
  tokens: "Tokens",
  cost: "Spend",
};

function isMetric(value: string | undefined): value is GenerationMetric {
  return METRICS.includes(value as GenerationMetric);
}

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCostCell(costUsd: number | null): string {
  if (costUsd === null) return "—";
  return `$${costUsd < 1 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
}

/**
 * F113 — Track Model Used (#110) / F213 — LLM Cost Tracking (#208) / F112 — Save
 * AI Prompt and Output (#109). Admin-only (platform-settings:manage).
 * One tab of the Artificial Intelligence group — see `src/app/(app)/admin/ai-group.ts`.
 *
 * AC1/AC2 of F113 (which model, snapshotted at generation time), F213's
 * token/cost figures, and F112's exact prompt/output are all satisfied upstream,
 * at the point of generation — every row already carries what actually happened,
 * written once and never re-derived (see the stage-one route). This page is
 * purely the "let an admin see and filter it without direct database access"
 * half: F113 AC3, F213 AC2, and F112 AC3. The prompt/output for each row sits
 * behind a <details> disclosure in the history list — full text, not a preview,
 * since AC1 is specifically about the *exact* prompt and output.
 *
 * TWO READS, ON PURPOSE. The charts need every generation in scope and the
 * history list needs one page of them; those are different shapes of the same
 * data, so they are two queries. The chart read takes the light columns only
 * (model, day, tokens, cost) so it stays cheap however long the table gets; the
 * history read takes the prompt and output text, and only for the rows on the
 * page being looked at. A search reaches the database — the filters below are
 * query parameters, not a filter over whatever happened to be loaded.
 *
 * The two charts answer different questions on purpose. The model breakdown
 * always reflects every generation — it is "the whole picture" that shows what
 * each model accounts for, and clicking a bar is how you set the filter in the
 * first place, so pre-narrowing it would be circular. The spend-over-time chart
 * is the one an active model filter reshapes: once you have picked a model, its
 * trend line shows that model's day-by-day history (clearing the filter via the
 * dropdown's "all models" option returns it to everything). `?metric=`
 * (count/tokens/cost) governs both charts at once, from one control, so they
 * can't show two different metrics at the same time.
 *
 * `?client=<organisation id>` is different from the search and the model filter:
 * it's a hard scope, not a lens, so it's applied before the charts/breakdown are
 * computed rather than only narrowing the history table — arriving here from a
 * specific client (via the shortcut on that client's page) means "show me this
 * client's generations", not "explore everything, narrowed by client".
 *
 * The root element is a `div`, not a `main`: the admin layout's AppShell already
 * renders the `main` this is slotted into.
 */
export default async function AiGenerationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const authorization = await getViewingActor("platform-settings:manage", {
    route: "/admin/ai-generations",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const params = await searchParams;
  const metric: GenerationMetric = isMetric(params.metric) ? params.metric : "count";
  const clientFilter =
    params.client && z.uuid().safeParse(params.client).success ? params.client : undefined;
  const models = parseModels(params.model);
  const search = cleanSearchTerm(params.q);
  const edited = parseEdited(params.edited);
  const sentBy = params.sentBy && z.uuid().safeParse(params.sentBy).success ? params.sentBy : undefined;
  const { page, pageSize } = parseGenerationPage(params.page, params.pageSize);

  const supabase = await createClient();

  // ---------------------------------------------------------------------------
  // The charts: every row in the client's scope, light columns only.
  // ---------------------------------------------------------------------------
  // The embedded message rides along even though nothing reads it here: an
  // embedded filter (the client scope) needs its resource in the select, and
  // `organisation_id` is one uuid per row.
  let chartQuery = supabase
    .from("ai_generations")
    .select("model, created_at, total_tokens, cost_usd, outreach_message:outreach_messages(organisation_id)");
  if (clientFilter) chartQuery = chartQuery.eq("outreach_messages.organisation_id", clientFilter);
  const chartRead = await chartQuery.overrideTypes<ChartRow[], { merge: false }>();

  // ---------------------------------------------------------------------------
  // The search term, as ids the generations table can be asked about.
  // ---------------------------------------------------------------------------
  // The free text matches a client name *or* what the model was asked to write.
  // Both halves have to be columns of `ai_generations` for one `or` expression to
  // carry them, so the client half is resolved to the clients' message ids here
  // rather than filtered through the embedded table.
  let clientMessageIds: string[] = [];
  let clientMatchesTruncated = false;
  if (search) {
    const { data: clientMatches, error: clientMatchError } = await supabase
      .from("organisations")
      .select("id")
      .ilike("legal_name", generationSearchPattern(search))
      .order("legal_name", { ascending: true })
      .limit(GENERATION_CLIENT_MATCH_LIMIT + 1);
    if (clientMatchError) {
      await reportError(clientMatchError, { operation: "admin.ai_generations.search_clients" });
    }

    const matchedOrgs = (clientMatches ?? []).map((row) => row.id);
    clientMatchesTruncated = matchedOrgs.length > GENERATION_CLIENT_MATCH_LIMIT;
    const orgIds = matchedOrgs.slice(0, GENERATION_CLIENT_MATCH_LIMIT);

    if (orgIds.length > 0) {
      const { data: messages, error: messageError } = await supabase
        .from("outreach_messages")
        .select("id")
        .in("organisation_id", orgIds)
        .limit(GENERATION_MESSAGE_MATCH_LIMIT);
      if (messageError) {
        await reportError(messageError, { operation: "admin.ai_generations.search_messages" });
      }
      clientMessageIds = (messages ?? []).map((row) => row.id);
    }
  }

  // ---------------------------------------------------------------------------
  // The history: one page, with everything the reader asked to see.
  // ---------------------------------------------------------------------------
  let historyQuery = supabase
    .from("ai_generations")
    .select(GENERATION_ROW_COLUMNS, { count: "exact" });
  if (clientFilter) historyQuery = historyQuery.eq("outreach_messages.organisation_id", clientFilter);
  if (models.length > 0) historyQuery = historyQuery.in("model", models);
  if (edited === "yes") historyQuery = historyQuery.eq("cam_edited", true);
  if (edited === "no") historyQuery = historyQuery.eq("cam_edited", false);
  if (sentBy) historyQuery = historyQuery.eq("outreach_messages.sent_by_user_id", sentBy);
  if (search) {
    const expression = generationSearchOrExpression(search, clientMessageIds);
    historyQuery = expression
      ? historyQuery.or(expression)
      : historyQuery.ilike("generated_subject", generationSearchPattern(search));
  }

  const from = (page - 1) * pageSize;
  const { data, count, error } = await historyQuery
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1)
    .overrideTypes<GenerationRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.ai_generations.page_list" });
  }

  // Fetched separately so the client's name still shows in the header even when
  // they have zero generations yet — the join above only has a name to offer for
  // rows that already exist.
  let clientName: string | null = null;
  if (clientFilter) {
    const { data: clientOrg } = await supabase
      .from("organisations")
      .select("legal_name")
      .eq("id", clientFilter)
      .maybeSingle();
    clientName = clientOrg?.legal_name ?? null;
  }

  // The team, for the "generated by" filter and for naming whoever a row
  // attributes. Bounded by headcount, so it is read whole — the same list the
  // analytics page filters by.
  const { data: teamRows } = await supabase
    .from("users")
    .select("id, full_name, role")
    .in("role", ["cam", "admin"])
    .eq("is_active", true)
    .order("full_name", { ascending: true })
    .overrideTypes<{ id: string; full_name: string | null; role: string }[], { merge: false }>();

  const team = teamRows ?? [];
  const teamName = new Map(team.map((member) => [member.id, member.full_name?.trim() || null]));
  const sentByName = sentBy ? (teamName.get(sentBy) ?? null) : null;

  // Already scoped in the query above when `?client=` is set.
  const chartRows = chartRead.data ?? [];
  const rows = data ?? [];
  const total = count ?? rows.length;
  const records: GenerationRecord[] = chartRows.map((row) => ({
    model: row.model,
    createdAt: row.created_at,
    totalTokens: row.total_tokens,
    costUsd: row.cost_usd,
  }));
  const breakdown = groupByModel(records, metric);
  const dayPoints = groupByDay(
    models.length > 0 ? records.filter((row) => models.includes(row.model)) : records,
    metric,
  );
  const modelOptions = breakdown.map((entry) => ({ label: entry.model, value: entry.model }));
  const modelLabel = models.length > 0 ? models.join(", ") : null;
  // One picked model is "the active bar"; several are a narrowed list, which no
  // single bar can be shown as.
  const activeModel = models.length === 1 ? models[0] : null;

  const filtersInWords = describeGenerationFilters(
    { search, models, edited, sentBy: sentBy ?? null },
    sentByName,
  );
  const chartError = chartRead.error;
  const pageError = error;

  const basePath = "/admin/ai-generations";

  /**
   * Whether the pager is worth drawing. A handful of generations is one page at
   * every size on offer, so the card gets its count line and nothing to adjust.
   */
  const paged = pagingIsUseful(total, GENERATION_PAGE_SIZES);
  /**
   * Everything the reader has narrowed by, as a query string. One source for
   * both this page's own links and the two model controls inside the breakdown
   * card — without it, clicking a model bar would quietly drop the search, the
   * edit filter, the chosen page size and even the chart metric.
   *
   * Repeated, not joined: a multi-select writes one parameter per value, and a
   * model name is a string a comma could appear in.
   */
  const currentQuery = (() => {
    const query = new URLSearchParams();
    for (const model of models) query.append("model", model);
    if (metric !== "count") query.set("metric", metric);
    if (clientFilter) query.set("client", clientFilter);
    if (search) query.set("q", search);
    if (edited) query.set("edited", edited);
    if (sentBy) query.set("sentBy", sentBy);
    if (pageSize !== DEFAULT_GENERATION_PAGE_SIZE) query.set("pageSize", String(pageSize));
    return query.toString();
  })();

  /**
   * A page number past the end of the list lands on the last real page instead of
   * on an empty window. The count above the rows is read from the page number, so
   * letting a stale one through would print "Showing 61 to 63 of 63" over nothing —
   * the page and its own count disagreeing in front of the reader. Only reachable
   * by hand-editing the URL, since every link on this page drops `page`.
   */
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (page > lastPage) {
    const query = new URLSearchParams(currentQuery);
    if (lastPage > 1) query.set("page", String(lastPage));
    const target = query.toString();
    redirect(target ? `${basePath}?${target}` : basePath);
  }

  // `"key" in changes` (not `!== undefined`) so that passing `{ model: undefined }`
  // explicitly clears a filter — a plain `!== undefined` check can't tell that
  // apart from the key being absent, and silently keeps the old value instead.
  // Every link drops `page`: a different filter is a different list, and page 4
  // of the last one is not a page of this one.
  const hrefWith = (changes: { model?: string; metric?: string; client?: string }) => {
    const query = new URLSearchParams(currentQuery);
    if ("model" in changes) {
      query.delete("model");
      if (changes.model) query.append("model", changes.model);
    }
    if ("metric" in changes) {
      query.delete("metric");
      if (changes.metric && changes.metric !== "count") query.set("metric", changes.metric);
    }
    if ("client" in changes) {
      query.delete("client");
      if (changes.client) query.set("client", changes.client);
    }
    query.delete("page");
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <SearchRail
        className="max-w-6xl"
        stageClassName="space-y-8"
        bar={
          <BrandSearchBar
            tone="light"
            placeholder="Search"
            subjects={["generations", "clients", "subjects", "models"]}
            recentKey="ai-generation-search"
            defaultQuery={search ?? ""}
            defaultFilters={[
              ...models.map((model) => ({
                category: "Filter by model",
                label: model,
                value: model,
              })),
              ...(sentBy
                ? [
                    {
                      category: "Filter by team member",
                      label: sentByName ?? "One team member",
                      value: sentBy,
                    },
                  ]
                : []),
              ...(edited
                ? [
                    {
                      category: "Filter by editing",
                      label: edited === "yes" ? "Edited before sending" : "Sent as generated",
                      value: edited,
                    },
                  ]
                : []),
            ]}
            categories={{
              "Filter by model": modelOptions,
              "Filter by team member": team.map((member) => ({
                label: member.full_name?.trim() || "Unnamed team member",
                value: member.id,
              })),
              "Filter by editing": [
                { label: "Edited before sending", value: "yes" },
                { label: "Sent as generated", value: "no" },
              ],
            }}
            params={{
              "Filter by model": "model",
              "Filter by team member": "sentBy",
              "Filter by editing": "edited",
            }}
          />
        }
        heading={
          <AiHeader current="/admin/ai-generations">
            <p className="mt-3 text-sm leading-[1.7] text-dim">
              Every AI-generated email draft, which model produced it, and its token
              usage and cost — for comparing model performance and spend over time. A
              later change to the default model or a pricing rate never rewrites what
              an older row says actually happened.
            </p>
            {clientFilter && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-inset bg-paper px-4 py-3">
                <p className="text-sm text-ink">
                  Showing <span className="font-semibold">{clientName ?? "this client"}</span> only.
                </p>
                <Link
                  className="text-sm font-semibold text-lead underline underline-offset-2 hover:text-lead-mid"
                  href={hrefWith({ client: undefined })}
                >
                  Show all clients
                </Link>
              </div>
            )}
            {(chartError || pageError) && (
              <div className="mt-4">
                <InlineAlert
                  variant="page"
                  message="Some generation history could not be loaded. This has been recorded — refresh and try again."
                />
              </div>
            )}
          </AiHeader>
        }
      >
        <Group className="space-y-6">
          {/* One control governs both charts below it, so "tokens" or "cost" is
              never shown on one and "generations" on the other at the same time. */}
          <Rise>
            <nav aria-label="Metric" className="flex flex-wrap items-center gap-1.5">
              {METRICS.map((option) => {
                const active = option === metric;
                return (
                  <Link
                    className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-black/[0.08] font-bold text-black"
                        : "font-semibold text-black/60 hover:bg-black/[0.05] hover:text-black"
                    }`}
                    href={hrefWith({ metric: option })}
                    key={option}
                    aria-current={active ? "true" : undefined}
                  >
                    {METRIC_LABEL[option]}
                  </Link>
                );
              })}
            </nav>
          </Rise>

          <Rise>
            <SpendOverTime metric={metric} points={dayPoints} />
          </Rise>

          <Rise>
            <SectionCard
              headingId="generations-by-model"
              title={`${METRIC_LABEL[metric]} by model`}
              hint="Click a model to filter the history below it. The chart itself always shows every model."
              action={
                <div className="flex items-center gap-3">
                  {models.length > 0 && (
                    <Link
                      className="text-sm font-semibold text-lead underline underline-offset-2 hover:text-lead-mid"
                      href={hrefWith({ model: undefined })}
                    >
                      Clear filter
                    </Link>
                  )}
                  <ModelFilterSelect
                    activeModel={activeModel}
                    basePath={basePath}
                    carryQuery={currentQuery}
                    clientFilter={clientFilter}
                    models={modelOptions.map((option) => option.value)}
                  />
                </div>
              }
            >
              <div className="mt-4">
                <ModelBreakdown
                  activeModel={activeModel}
                  basePath={basePath}
                  breakdown={breakdown}
                  carryQuery={currentQuery}
                  clientFilter={clientFilter}
                  metric={metric}
                />
              </div>
            </SectionCard>
          </Rise>

          <Rise>
            <SectionCard
              headingId="generation-history"
              title={modelLabel ? `History — ${modelLabel}` : "History"}
              hint={
                <>
                  {total.toLocaleString()} generation{total === 1 ? "" : "s"}
                  {filtersInWords ? ` · ${filtersInWords}` : ""}
                </>
              }
              action={paged ? <HistoryPageSize pageSize={pageSize} /> : undefined}
            >
              {/* One page of history at a time: every row below carries a full
                  prompt and output, so the database — not the browser — is asked
                  for a window, and the window is chosen from here. The count sits
                  above the rows rather than in a footer: this list only grows, and
                  the reader has to see how much of it they are looking at. */}
              {paged && (
                <div className="mt-4">
                  <HistoryPagingSummary totalItems={total} page={page} pageSize={pageSize} />
                </div>
              )}

              {rows.length === 0 ? (
                <p className="px-1 py-10 text-center text-sm text-dim">
                  {filtersInWords
                    ? "No generations match these filters yet."
                    : modelLabel && clientFilter
                      ? `No generations recorded for ${modelLabel} on this client yet.`
                      : modelLabel
                        ? `No generations recorded for ${modelLabel} yet.`
                        : clientFilter
                          ? "No generations recorded for this client yet."
                          : "No generations recorded yet."}
                </p>
              ) : (
                <ul
                  className={`divide-y divide-rule-soft border-t border-rule-soft ${
                    paged ? "mt-3" : "mt-4"
                  }`}
                >
                  {rows.map((row) => (
                    <li className="py-4 first:pt-4" key={row.id}>
                      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">
                            {row.outreach_message?.organisation?.legal_name ?? "Unknown client"}
                          </p>
                          <p className="mt-0.5 truncate text-sm text-dim">
                            {row.generated_subject ?? "(no subject)"}
                          </p>
                          <p className="mt-1 text-[13.5px] text-dim">
                            {formatGeneratedAt(row.created_at)}
                            {row.outreach_message?.sent_by?.full_name
                              ? ` · Generated for ${row.outreach_message.sent_by.full_name}`
                              : ""}
                            {" · "}
                            {row.total_tokens !== null ? `${row.total_tokens.toLocaleString()} tokens` : "tokens unknown"}
                            {" · "}
                            {formatCostCell(row.cost_usd)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          <Pill tone="lead" dot={false}>
                            {row.model}
                          </Pill>
                          {row.cam_edited && (
                            <Pill tone="neutral">Edited before send</Pill>
                          )}
                        </div>
                      </div>

                      {/* F112 AC3 — the exact prompt and output, accessible to an admin
                          without needing direct database access. Collapsed by default:
                          this is the raw record for the rare "why did it write that"
                          question, not something scanned on every row. */}
                      <details className="mt-2.5">
                        <summary className="w-fit cursor-pointer list-none text-sm font-semibold text-lead underline underline-offset-2 hover:text-lead-mid [&::-webkit-details-marker]:hidden">
                          View prompt &amp; output
                        </summary>
                        <div className="mt-3 space-y-4 rounded-inset bg-paper p-5">
                          <div>
                            <Key>System prompt</Key>
                            <p className="mt-2 text-sm leading-[1.65] whitespace-pre-wrap text-ink">
                              {row.prompt_system}
                            </p>
                          </div>
                          <div className="border-t border-rule-soft pt-4">
                            <Key>User prompt</Key>
                            <p className="mt-2 text-sm leading-[1.65] whitespace-pre-wrap text-ink">
                              {row.prompt_user}
                            </p>
                          </div>
                          <div className="border-t border-rule-soft pt-4">
                            <Key>Output</Key>
                            <p className="mt-2 text-sm font-semibold text-ink">
                              {row.generated_subject ?? "(no subject)"}
                            </p>
                            <p className="mt-2 text-sm leading-[1.65] whitespace-pre-wrap text-ink">
                              {row.generated_body ?? "(no body)"}
                            </p>
                          </div>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}

              {clientMatchesTruncated && (
                <p className="mt-3 text-[12px] leading-[1.5] text-dim">
                  More than {GENERATION_CLIENT_MATCH_LIMIT} clients match this search, so it covers the
                  first {GENERATION_CLIENT_MATCH_LIMIT} of them. Add a word to narrow it.
                </p>
              )}
            </SectionCard>
          </Rise>
        </Group>
      </SearchRail>
    </div>
  );
}
