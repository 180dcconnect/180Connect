import Link from "next/link";
import { redirect } from "next/navigation";
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
type SearchParams = Promise<{ model?: string; metric?: string }>;

type GenerationRow = {
  id: string;
  model: string;
  generated_subject: string | null;
  cam_edited: boolean;
  created_at: string;
  total_tokens: number | null;
  cost_usd: number | null;
  outreach_message: {
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
 * F113 — Track Model Used (#110) / F213 — LLM Cost Tracking (#208). Admin-only
 * (platform-settings:manage, same fit as /admin/import-status — no dedicated
 * permission exists for either ticket yet).
 *
 * AC1/AC2 of F113 (which model, snapshotted at generation time) and F213's
 * token/cost figures are all satisfied upstream, at the point of generation —
 * every row already carries what actually happened, written once and never
 * re-derived (see the stage-one route). This page is purely the "let an admin
 * see and filter it" half: F113 AC3 and F213 AC2.
 *
 * The spend-over-time chart and the model breakdown both always reflect every
 * generation regardless of the active `?model=` filter — they're "the whole
 * picture" the filter narrows the table against, not something the filter
 * itself re-shapes. `?metric=` (count/tokens/cost) governs both charts at once,
 * from one control, so they can't show two different metrics at the same time.
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

  const { model: modelFilter, metric: metricParam } = await searchParams;
  const metric: GenerationMetric = isMetric(metricParam) ? metricParam : "count";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_generations")
    .select(
      "id, model, generated_subject, cam_edited, created_at, total_tokens, cost_usd, outreach_message:outreach_messages(organisation:organisations(legal_name), sent_by:users(full_name))",
    )
    .order("created_at", { ascending: false })
    .overrideTypes<GenerationRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.ai_generations.page_list" });
  }

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
  const hrefWith = (changes: { model?: string; metric?: string }) => {
    const params = new URLSearchParams();
    const nextModel = changes.model !== undefined ? changes.model : modelFilter;
    const nextMetric = changes.metric !== undefined ? changes.metric : metric;
    if (nextModel) params.set("model", nextModel);
    if (nextMetric && nextMetric !== "count") params.set("metric", nextMetric);
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
              <ModelFilterSelect activeModel={modelFilter ?? null} basePath={basePath} models={models} />
            </div>
          </div>
          <div className="mt-5">
            <ModelBreakdown activeModel={modelFilter ?? null} basePath={basePath} breakdown={breakdown} metric={metric} />
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] px-6 py-4">
            <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-foreground/50">
              {modelFilter ? `History — ${modelFilter}` : "History — all models"}
            </h2>
            <p className="text-xs font-bold text-foreground/35">
              {rows.length.toLocaleString()} generation{rows.length === 1 ? "" : "s"}
            </p>
          </div>

          {rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-foreground/50">
              {modelFilter
                ? `No generations recorded for ${modelFilter} yet.`
                : "No generations recorded yet."}
            </p>
          ) : (
            <ul>
              {rows.map((row) => (
                <li
                  className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5 border-b border-black/[0.06] px-6 py-4 last:border-b-0"
                  key={row.id}
                >
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
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
