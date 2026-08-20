"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { formatCompact } from "@/components/ui/metric-chart";
import type { GenerationMetric, GenerationModelBreakdown } from "@/lib/outreach/generation-history";

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
}: {
  breakdown: GenerationModelBreakdown[];
  metric: GenerationMetric;
  activeModel: string | null;
  basePath: string;
}) {
  const reducedMotion = useReducedMotion();

  if (breakdown.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 px-6 py-10 text-center">
        <p className="text-sm text-foreground/50">
          No generations recorded yet — this fills in as CAMs generate drafts.
        </p>
      </div>
    );
  }

  const peak = Math.max(...breakdown.map((entry) => metricValue(metric, entry)));

  return (
    <div role="group" aria-label="Generations by model">
      <ul className="space-y-3">
        {breakdown.map((entry, index) => {
          const isActive = entry.model === activeModel;
          const value = metricValue(metric, entry);
          const widthPercent = peak > 0 ? (value / peak) * 100 : 0;
          const unknown = hasUnknownValue(metric, entry);
          return (
            <li key={entry.model}>
              <Link
                aria-current={isActive ? "true" : undefined}
                className={`group block rounded-xl px-3 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  isActive ? "bg-brand/10" : "hover:bg-black/[0.03]"
                }`}
                href={isActive ? basePath : `${basePath}?model=${encodeURIComponent(entry.model)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`truncate text-sm font-bold ${isActive ? "text-brand-hover" : "text-foreground/80"}`}
                  >
                    {entry.model}
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-foreground/50">
                    {formatMetric(metric, entry)}
                    {unknown && (
                      <span className="ml-1 text-xs font-medium text-amber-700" title="Some generations are missing this figure">
                        ~
                      </span>
                    )}
                    <span className="ml-1.5 text-xs font-medium text-foreground/35">
                      ({Math.round(entry.share * 100)}% of generations)
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/[0.05]">
                  <motion.div
                    animate={{ width: `${widthPercent}%` }}
                    className={`h-full rounded-full ${isActive ? "bg-brand-hover" : "bg-brand"}`}
                    initial={{ width: reducedMotion ? `${widthPercent}%` : 0 }}
                    transition={{ duration: 0.5, delay: reducedMotion ? 0 : index * 0.06, ease: [0.16, 1, 0.3, 1] }}
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
