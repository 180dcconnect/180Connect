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
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Key, Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { AiHeader } from "../ai-header";
import { ModelBreakdown } from "./model-breakdown";
import { ModelFilterSelect } from "./model-filter-select";
import { SpendOverTime } from "./spend-over-time";

// Next.js 16: searchParams is a Promise on App Router pages — same pattern as
// src/app/(app)/clients/page.tsx.
type SearchParams = Promise<{ model?: string; metric?: string; client?: string }>;

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
 * The two charts answer different questions on purpose. The model breakdown
 * always reflects every generation — it is "the whole picture" that shows what
 * each model accounts for, and clicking a bar is how you set the filter in the
 * first place, so pre-narrowing it would be circular. The spend-over-time chart
 * is the one the active `?model=` filter reshapes: once you have picked a model,
 * its trend line shows that model's day-by-day history (clearing the filter via
 * the dropdown's "all models" option returns it to everything). `?metric=`
 * (count/tokens/cost) governs both charts at once, from one control, so they
 * can't show two different metrics at the same time.
 *
 * `?client=<organisation id>` is different from `?model=`: it's a hard scope, not
 * a lens, so it's applied before the charts/breakdown are computed rather than
 * only narrowing the history table — arriving here from a specific client (via
 * the shortcut on that client's page) means "show me this client's generations",
 * not "explore everything, narrowed by client". `?model=` still applies on top
 * of it as a further lens within that scope.
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

  const { model: modelFilter, metric: metricParam, client: clientParam } = await searchParams;
  const metric: GenerationMetric = isMetric(metricParam) ? metricParam : "count";
  const clientFilter = clientParam && z.uuid().safeParse(clientParam).success ? clientParam : undefined;

  const supabase = await createClient();
  let query = supabase.from("ai_generations").select(
    "id, model, generated_subject, generated_body, prompt_system, prompt_user, cam_edited, created_at, total_tokens, cost_usd, outreach_message:outreach_messages(organisation_id, organisation:organisations(legal_name), sent_by:users(full_name))",
  );
  // The client scope is a PostgREST filter on the embedded outreach message, not
  // an in-JS pass over everything: rows carry full prompt/output text, so
  // filtering after fetch would pull every other client's prompts only to throw
  // them away. Same semantics as a JS filter — rows with no outreach message
  // never match an organisation id either way.
  if (clientFilter) {
    query = query.eq("outreach_messages.organisation_id", clientFilter);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
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

  // Already scoped in the query above when `?client=` is set.
  const generations = data ?? [];
  const records: GenerationRecord[] = generations.map((row) => ({
    model: row.model,
    createdAt: row.created_at,
    totalTokens: row.total_tokens,
    costUsd: row.cost_usd,
  }));
  const breakdown = groupByModel(records, metric);
  const dayPoints = groupByDay(
    modelFilter ? records.filter((row) => row.model === modelFilter) : records,
    metric,
  );
  const rows = modelFilter ? generations.filter((row) => row.model === modelFilter) : generations;
  const models = breakdown.map((entry) => entry.model);

  const basePath = "/admin/ai-generations";
  // `"key" in changes` (not `!== undefined`) so that passing `{ model: undefined }`
  // explicitly clears a filter — a plain `!== undefined` check can't tell that
  // apart from the key being absent, and silently keeps the old value instead.
  const hrefWith = (changes: { model?: string; metric?: string; client?: string }) => {
    const params = new URLSearchParams();
    const nextModel = "model" in changes ? changes.model : modelFilter;
    const nextMetric = "metric" in changes ? changes.metric : metric;
    const nextClient = "client" in changes ? changes.client : clientFilter;
    if (nextModel) params.set("model", nextModel);
    if (nextMetric && nextMetric !== "count") params.set("metric", nextMetric);
    if (nextClient) params.set("client", nextClient);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto max-w-6xl space-y-8">
        <Rise>
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
            {error && (
              <div className="mt-4">
                <InlineAlert
                  variant="page"
                  message="Some generation history could not be loaded. This has been recorded — refresh and try again."
                />
              </div>
            )}
          </AiHeader>
        </Rise>

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
                  {modelFilter && (
                    <Link
                      className="text-sm font-semibold text-lead underline underline-offset-2 hover:text-lead-mid"
                      href={hrefWith({ model: undefined })}
                    >
                      Clear filter
                    </Link>
                  )}
                  <ModelFilterSelect
                    activeModel={modelFilter ?? null}
                    basePath={basePath}
                    clientFilter={clientFilter}
                    models={models}
                  />
                </div>
              }
            >
              <div className="mt-4">
                <ModelBreakdown
                  activeModel={modelFilter ?? null}
                  basePath={basePath}
                  breakdown={breakdown}
                  clientFilter={clientFilter}
                  metric={metric}
                />
              </div>
            </SectionCard>
          </Rise>

          <Rise>
            <SectionCard
              headingId="generation-history"
              title={modelFilter ? `History — ${modelFilter}` : "History"}
              hint={`${rows.length.toLocaleString()} generation${rows.length === 1 ? "" : "s"}`}
            >
              {rows.length === 0 ? (
                <p className="px-1 py-10 text-center text-sm text-dim">
                  {modelFilter && clientFilter
                    ? `No generations recorded for ${modelFilter} on this client yet.`
                    : modelFilter
                      ? `No generations recorded for ${modelFilter} yet.`
                      : clientFilter
                        ? "No generations recorded for this client yet."
                        : "No generations recorded yet."}
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-rule-soft border-t border-rule-soft">
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
            </SectionCard>
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
