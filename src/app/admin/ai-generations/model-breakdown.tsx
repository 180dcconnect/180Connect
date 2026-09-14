"use client";

import Image from "next/image";
import Link from "next/link";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { formatCompact } from "@/components/ui/metric-chart";
import type { GenerationMetric, GenerationModelBreakdown } from "@/lib/outreach/generation-history";

/**
 * Google's four brand colours, in G order, echoing the official Gemini mark
 * in `public/models/gemini.svg`. Logo colours — the same exemption as the
 * register marks in `public/sources/` — not app tokens, so they never stand
 * in for state. State still comes from `Pill`.
 */
const GEMINI_GRADIENT = ["#4285F4", "#EA4335", "#FBBC05", "#34A853"];

/**
 * Any Gemini model id, present or future. Google retires model ids
 * frequently, so this matches the family prefix rather than a list —
 * `gemini-3.6-flash` and whatever succeeds it both qualify.
 */
function isGeminiModel(model: string): boolean {
  return model.toLowerCase().startsWith("gemini");
}

function formatMetric(metric: GenerationMetric, entry: GenerationModelBreakdown): string {
  if (metric === "cost") return `$${entry.totalCostUsd < 1 ? entry.totalCostUsd.toFixed(4) : entry.totalCostUsd.toFixed(2)}`;
  if (metric === "tokens") return formatCompact(entry.totalTokens);
  return entry.count.toLocaleString();
}

function hasUnknownValue(metric: GenerationMetric, entry: GenerationModelBreakdown): boolean {
  if (metric === "cost") return entry.hasUnknownCost;
  if (metric === "tokens") return entry.hasUnknownTokens;
  return false;
}

function metricValue(metric: GenerationMetric, entry: GenerationModelBreakdown): number {
  if (metric === "cost") return entry.totalCostUsd;
  if (metric === "tokens") return entry.totalTokens;
  return entry.count;
}

/**
 * The gauge's hover tooltip reads raw numbers rather than a breakdown entry,
 * so the metric formatting is repeated here in value form. Kept beside
 * formatMetric so the two cannot drift apart.
 */
function formatGaugeValue(metric: GenerationMetric, value: number): string {
  if (metric === "cost") return `$${value < 1 ? value.toFixed(4) : value.toFixed(2)}`;
  if (metric === "tokens") return formatCompact(value);
  return Math.round(value).toLocaleString();
}

/**
 * F113 AC3 — "group by model" as a ranked bar breakdown. Every bar is also a
 * filter link (clicking narrows the table below to that model), same as
 * ModelFilterSelect right above it — two affordances for the same `?model=`
 * state, not two competing ones.
 */
export function ModelBreakdown({
  breakdown,
  metric,
  activeModel,
  basePath,
  clientFilter,
}: {
  breakdown: GenerationModelBreakdown[];
  metric: GenerationMetric;
  activeModel: string | null;
  basePath: string;
  clientFilter?: string | null;
}) {
  function hrefFor(model: string | null) {
    const params = new URLSearchParams();
    if (model) params.set("model", model);
    if (clientFilter) params.set("client", clientFilter);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  if (breakdown.length === 0) {
    return (
      <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-10 text-center">
        <p className="text-sm text-dim">
          No generations recorded yet — this fills in as CAMs generate drafts.
        </p>
      </div>
    );
  }

  const peak = Math.max(...breakdown.map((entry) => metricValue(metric, entry)));

  // Every row is missing this metric's figure (all nulls sum to a zero peak),
  // so the sticks below would sit empty with no explanation. Say so instead —
  // a dead gauge reads as broken, a sentence reads as "nothing recorded yet".
  // Unreachable on the count tab: a listed model has at least one generation.
  const nothingRecorded = peak === 0;

  return (
    <div role="group" aria-label="Generations by model">
      {nothingRecorded && (
        <p className="mb-4 rounded-inset bg-paper px-4 py-3 text-[13px] leading-[1.55] text-dim">
          {metric === "cost"
            ? "No spend figures recorded yet — nothing is priced, so the sticks have nothing to show. They fill in once a pricing rate is set and usage is reported."
            : "No token counts recorded yet, so the sticks have nothing to show. They fill in once usage is reported."}
        </p>
      )}
      <ul className="space-y-3">
        {breakdown.map((entry) => {
          const isActive = entry.model === activeModel;
          const value = metricValue(metric, entry);
          const unknown = hasUnknownValue(metric, entry);
          const gemini = isGeminiModel(entry.model);
          return (
            <li key={entry.model}>
              <Link
                aria-current={isActive ? "true" : undefined}
                className={`group block rounded-inset px-3 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead ${
                  isActive ? "bg-lead-wash" : "hover:bg-paper"
                }`}
                href={isActive ? hrefFor(null) : hrefFor(entry.model)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`flex min-w-0 items-center gap-1.5 text-sm font-bold ${isActive ? "text-lead" : "text-ink"}`}
                  >
                    {gemini && (
                      <Image
                        src="/models/gemini.svg"
                        alt=""
                        aria-hidden="true"
                        width={15}
                        height={15}
                        className="size-[15px] shrink-0"
                      />
                    )}
                    <span className="truncate">{entry.model}</span>
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-dim">
                    {formatMetric(metric, entry)}
                    {unknown && (
                      <span className="ml-1 text-xs font-medium text-hold" title="Some generations are missing this figure">
                        ~
                      </span>
                    )}
                    <span className="ml-1.5 text-xs font-medium text-faint">
                      ({Math.round(entry.share * 100)}% of generations)
                    </span>
                  </span>
                </div>
                {/* The same stick gauge as the stat cards elsewhere in the app,
                    peak-relative: each model's sticks show its share of the
                    biggest model, which is the comparison this chart exists
                    to make. Gemini rows run the four-colour Gemini gradient;
                    any other maker stays lead. */}
                <div className="mt-2">
                  <HorizontalStickGauge
                    checked={value}
                    total={peak}
                    ariaLabel={`${entry.model}: ${formatMetric(metric, entry)}`}
                    checkedLabel={entry.model}
                    remainingLabel="Gap to top model"
                    valueFormatter={(gaugeValue) => formatGaugeValue(metric, gaugeValue)}
                    activeGradient={gemini ? GEMINI_GRADIENT : undefined}
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
