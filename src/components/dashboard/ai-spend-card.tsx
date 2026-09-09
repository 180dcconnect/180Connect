import Link from "next/link";
import { aiSpendChange, formatUsd, AI_GENERATION_ACTIVITIES, AI_GENERATION_ACTIVITY_LABELS, type AiSpendSummary } from "@/lib/dashboard/ai-spend";

/**
 * F213 — month-to-date AI spend, admin only.
 *
 * `/admin/ai-generations` already answers "what did this email cost". This
 * answers "what are we spending this month, and is it accelerating", which is
 * the question nobody was asking because nothing on the platform put the number
 * anywhere. It is one figure and a link to the detail.
 *
 * Unpriced generations are surfaced, never folded into the total as zero: the
 * headline is honestly a floor when the provider gave us no usage data, and a
 * spend figure that quietly understates itself is worse than no figure.
 */
export function AiSpendCard({ summary }: { summary: AiSpendSummary }) {
  const change = aiSpendChange(summary);
  const rising = change !== null && change > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm dark:border-white/[0.08] dark:bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-5">
        <h3 className="text-[16px] font-semibold tracking-tight text-foreground">
          AI spend
        </h3>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
          Month to date
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 px-5 pb-4">
        <span className="text-[2.5rem] font-black leading-none tracking-[-0.03em] tabular-nums text-foreground">
          {formatUsd(summary.costUsd)}
        </span>
        {change !== null && (
          <span
            className={`pb-1 text-[13px] font-bold tabular-nums ${
              rising ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {rising ? "+" : "−"}
            {Math.abs(change).toFixed(0)}%
            <span className="ml-1.5 font-normal text-foreground/45">vs prior period</span>
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-black/[0.06] px-5 py-4 text-[13px]">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
            Generations
          </dt>
          <dd className="mt-1 font-bold tabular-nums text-foreground">
            {summary.generations.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
            Tokens
          </dt>
          <dd className="mt-1 font-bold tabular-nums text-foreground">
            {summary.totalTokens.toLocaleString()}
          </dd>
        </div>
        {summary.models.length > 0 && (
          <div className="col-span-2">
            <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Models
            </dt>
            <dd className="mt-1 truncate font-medium text-foreground/70">
              {summary.models.join(", ")}
            </dd>
          </div>
        )}
      </dl>

      {summary.spendByWeek.length > 0 && (
        <div className="border-t border-black/[0.06] px-5 py-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Spend by day</p>
          <div className="space-y-2.5">
            {summary.spendByWeek.map((bucket) => (
              <div key={bucket.key} className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-[11px] text-foreground/45">{bucket.label}</span>
                <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-black/[0.05]" title={formatUsd(bucket.totalCostUsd)}>
                  {AI_GENERATION_ACTIVITIES.map((activity) => {
                    const amount = bucket.byActivity[activity];
                    if (!amount) return null;
                    return <span key={activity} style={{ width: `${(amount / bucket.totalCostUsd) * 100}%` }} className={`first:bg-brand ${activity === "follow_up_email" ? "bg-sky-500" : activity === "client_booklet" ? "bg-violet-500" : activity === "other" ? "bg-slate-400" : "bg-indigo-500"}`} title={`${AI_GENERATION_ACTIVITY_LABELS[activity]}: ${formatUsd(amount)}`} />;
                  })}
                </div>
                <span className="w-14 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground/60">{formatUsd(bucket.totalCostUsd)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-foreground/45">
            {AI_GENERATION_ACTIVITIES.map((activity) => <span key={activity}><i className={`mr-1 inline-block h-2 w-2 rounded-full ${activity === "follow_up_email" ? "bg-sky-500" : activity === "client_booklet" ? "bg-violet-500" : activity === "other" ? "bg-slate-400" : "bg-indigo-500"}`} />{AI_GENERATION_ACTIVITY_LABELS[activity]}</span>)}
          </div>
        </div>
      )}

      {summary.unpriced > 0 && (
        <p className="border-t border-black/[0.06] bg-black/[0.02] px-5 py-3 text-[12px] leading-[1.6] text-foreground/55">
          {summary.unpriced.toLocaleString()} generation
          {summary.unpriced === 1 ? "" : "s"} carried no cost — the provider reported no
          usage, or no pricing row covered the model. The figure above is a floor.
        </p>
      )}

      <Link
        href="/admin/ai-generations"
        className="mt-auto border-t border-black/[0.06] px-5 py-3 text-[12px] font-bold text-foreground/50 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        Every generation and its cost →
      </Link>
    </div>
  );
}

export default AiSpendCard;
