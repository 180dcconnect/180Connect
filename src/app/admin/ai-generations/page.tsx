import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import {
  groupByDay,
  groupByModel,
  type GenerationMetric,
  type GenerationRecord,
} from "@/lib/outreach/generation-history";
import { ModelBreakdown } from "./model-breakdown";
import { ModelFilterSelect } from "./model-filter-select";
import { SpendOverTime } from "./spend-over-time";

// Next.js 16: searchParams is a Promise on App Router pages — same pattern as
// src/app/clients/page.tsx.
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
 * AI Prompt and Output (#109). Admin-only (platform-settings:manage, same fit as
 * /admin/import-status — no dedicated permission exists for any of these yet).
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
 */
export default async function AiGenerationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const authorization = await getCurrentActor("platform-settings:manage", {
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
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl">
        <div className="rounded-2xl bg-white p-8 shadow-sm">
          <p className="text-sm font-bold text-brand">Admin workspace</p>
          <h1 className="mt-2 text-2xl font-bold">AI generation history</h1>
          <p className="mt-3 text-sm text-foreground/65">
            Every AI-generated email draft, which model produced it, and its token
            usage and cost — for comparing model performance and spend over time. A
            later change to the default model or a pricing rate never rewrites what
            an older row says actually happened.
          </p>

          {clientFilter && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand/[0.06] px-4 py-3">
              <p className="text-sm">
                Showing <span className="font-bold text-brand-hover">{clientName ?? "this client"}</span> only.
              </p>
              <Link
                className="text-xs font-bold uppercase tracking-[0.08em] text-brand-hover underline underline-offset-2 hover:text-brand"
                href={hrefWith({ client: undefined })}
              >
                Show all clients
              </Link>
            </div>
          )}

          {error && (
            <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
              Some generation history could not be loaded. Refresh and try again.
            </p>
          )}
        </div>

        {/* One control governs both charts below it, so "tokens" or "cost" is
            never shown on one and "generations" on the other at the same time. */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 rounded-full bg-black/[0.04] p-1 w-fit">
          {METRICS.map((option) => (
            <Link
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
                option === metric ? "bg-white text-brand-hover shadow-sm" : "text-foreground/50 hover:text-foreground/75"
              }`}
              href={hrefWith({ metric: option })}
              key={option}
            >
              {METRIC_LABEL[option]}
            </Link>
          ))}
        </div>

        <div className="mt-4">
          <SpendOverTime metric={metric} points={dayPoints} />
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-brand/15 bg-gradient-to-br from-white to-brand/[0.06] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{METRIC_LABEL[metric]} by model</h2>
            <div className="flex items-center gap-3">
              {modelFilter && (
                <Link
                  className="text-xs font-bold uppercase tracking-[0.08em] text-brand-hover underline underline-offset-2 hover:text-brand"
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
          </div>
          <div className="mt-5">
            <ModelBreakdown
              activeModel={modelFilter ?? null}
              basePath={basePath}
              breakdown={breakdown}
              clientFilter={clientFilter}
              metric={metric}
            />
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] px-6 py-4">
            <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-foreground/50">
              {modelFilter ? `History — ${modelFilter}` : "History"}
            </h2>
            <p className="text-xs font-bold text-foreground/35">
              {rows.length.toLocaleString()} generation{rows.length === 1 ? "" : "s"}
            </p>
          </div>

          {rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-foreground/50">
              {modelFilter && clientFilter
                ? `No generations recorded for ${modelFilter} on this client yet.`
                : modelFilter
                  ? `No generations recorded for ${modelFilter} yet.`
                  : clientFilter
                    ? "No generations recorded for this client yet."
                    : "No generations recorded yet."}
            </p>
          ) : (
            <ul>
              {rows.map((row) => (
                <li className="border-b border-black/[0.06] px-6 py-4 last:border-b-0" key={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">
                        {row.outreach_message?.organisation?.legal_name ?? "Unknown client"}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-foreground/60">
                        {row.generated_subject ?? "(no subject)"}
                      </p>
                      <p className="mt-1 text-xs text-foreground/40">
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
                      <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-brand-hover">
                        {row.model}
                      </span>
                      {row.cam_edited && (
                        <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-foreground/55">
                          Edited before send
                        </span>
                      )}
                    </div>
                  </div>

                  {/* F112 AC3 — the exact prompt and output, accessible to an admin
                      without needing direct database access. Collapsed by default:
                      this is the raw record for the rare "why did it write that"
                      question, not something scanned on every row. */}
                  <details className="mt-2.5">
                    <summary className="w-fit cursor-pointer list-none text-xs font-bold text-brand-hover underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                      View prompt &amp; output
                    </summary>
                    <div className="mt-3 space-y-4 rounded-xl border border-black/[0.06] bg-white p-5">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-hover">
                          System prompt
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85">
                          {row.prompt_system}
                        </p>
                      </div>
                      <div className="border-t border-black/[0.06] pt-4">
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-hover">
                          User prompt
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85">
                          {row.prompt_user}
                        </p>
                      </div>
                      <div className="rounded-lg bg-brand/[0.06] p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-hover">
                          Output
                        </p>
                        <p className="mt-2 text-[15px] font-bold text-foreground/90">
                          {row.generated_subject ?? "(no subject)"}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85">
                          {row.generated_body ?? "(no body)"}
                        </p>
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
