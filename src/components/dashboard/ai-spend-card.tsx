import Link from "next/link";
import { aiSpendChange, formatUsd, type AiSpendSummary } from "@/lib/dashboard/ai-spend";
import { AiSpendDailyChart } from "@/components/dashboard/ai-spend-daily-chart";

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
    <section className="flex h-full flex-col rounded-panel border border-rule bg-white">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-rule-soft px-5 py-5 sm:px-6">
        <div>
          <h3 className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">AI spend</h3>
          <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">This month&apos;s priced AI use</p>
        </div>
        <div className="text-right">
          <p className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
          {formatUsd(summary.costUsd)}
          </p>
          {change !== null && (
            <p
              className={`mt-1.5 font-body text-[12.5px] font-semibold tabular-nums ${
              rising ? "text-stop" : "text-go"
            }`}
            >
              {rising ? "+" : "−"}{Math.abs(change).toFixed(0)}% <span className="font-normal text-dim">vs prior period</span>
            </p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 border-b border-rule-soft px-5 py-4 sm:px-6">
        <div>
          <dt className="font-body text-[12.5px] text-dim">Generations</dt>
          <dd className="mt-1 font-body text-[20px] leading-none font-semibold tabular-nums text-ink">
            {summary.generations.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="font-body text-[12.5px] text-dim">Tokens</dt>
          <dd className="mt-1 font-body text-[20px] leading-none font-semibold tabular-nums text-ink">
            {summary.totalTokens.toLocaleString()}
          </dd>
        </div>
        {summary.models.length > 0 && (
          <div className="col-span-2">
            <dt className="font-body text-[12.5px] text-dim">Models</dt>
            <dd className="mt-1 truncate font-body text-[13px] font-medium text-ink">
              {summary.models.join(", ")}
            </dd>
          </div>
        )}
      </dl>

      <div className="px-5 py-5 sm:px-6">
        <AiSpendDailyChart summary={summary} />
      </div>

      {summary.unpriced > 0 && (
        <p className="mx-5 mb-5 rounded-inset bg-paper px-3 py-2.5 font-body text-[12.5px] leading-[1.55] text-dim sm:mx-6">
          {summary.unpriced.toLocaleString()} generation
          {summary.unpriced === 1 ? "" : "s"} carried no cost — the provider reported no
          usage, or no pricing row covered the model. The figure above is a floor.
        </p>
      )}

      <Link
        href="/admin/ai-generations"
        className="mt-auto border-t border-rule-soft px-5 py-3.5 font-body text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead sm:px-6"
      >
        Every generation and its cost →
      </Link>
    </section>
  );
}

export default AiSpendCard;
