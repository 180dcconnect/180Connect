"use client";

import { AlertTriangle, CheckCircle2, Clock, ShieldCheck } from "lucide-react";

import {
  STATUTORY_DEADLINE_DAYS,
  type FilingTimelinessSummary,
} from "@/lib/financials/filing-timeliness";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";

export function FilingTimelinessCard({
  summary,
}: {
  summary: FilingTimelinessSummary;
}) {
  const {
    averageDays,
    lateCount,
    totalWithFilingDate,
    healthTone,
    healthBadge,
    headline,
    insight,
    latestDays,
    reportingStatus,
    isOverdue,
  } = summary;

  const displayDays = latestDays ?? averageDays ?? 0;

  const badgeClass =
    healthTone === "go"
      ? "bg-go-wash text-go"
      : healthTone === "stop"
        ? "bg-stop-wash text-stop"
        : healthTone === "hold"
          ? "bg-hold-wash text-hold"
          : "bg-paper-sunk text-dim";

  const StatusIcon = isOverdue
    ? AlertTriangle
    : healthTone === "go"
      ? ShieldCheck
      : healthTone === "hold"
        ? Clock
        : CheckCircle2;

  return (
    <div className="rounded-panel border border-rule-soft bg-paper/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusIcon
            aria-hidden="true"
            className={`size-4 shrink-0 ${
              healthTone === "go"
                ? "text-go"
                : healthTone === "stop"
                  ? "text-stop"
                  : healthTone === "hold"
                    ? "text-hold"
                    : "text-dim"
            }`}
          />
          <h4 className="text-[13.5px] font-semibold text-ink">{headline}</h4>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide uppercase ${badgeClass}`}
        >
          {healthBadge}
        </span>
      </div>

      {/* 10-Month Statutory Timeline Stick Gauge */}
      {totalWithFilingDate > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-faint">
            <span>Year-end (Day 0)</span>
            <span className="font-semibold text-dim">
              {latestDays !== null ? `${latestDays} days to file` : `${averageDays}d average`}
            </span>
            <span className="text-hold">10-month deadline (Day 305)</span>
          </div>

          <HorizontalStickGauge
            checked={displayDays}
            total={STATUTORY_DEADLINE_DAYS}
            pitch={8.5}
            stickWidth={3}
            stickHeight={16}
            activeColor={
              isOverdue || healthTone === "stop"
                ? "var(--stop)"
                : healthTone === "hold"
                  ? "#b54708"
                  : healthTone === "go"
                    ? "#067647"
                    : "var(--lead)"
            }
            inactiveColor="var(--rule-soft)"
            hoverInactiveColor={healthTone === "hold" ? "#d97706" : "var(--faint)"}
            checkedLabel={latestDays !== null ? "Days to file" : "Average days to file"}
            remainingLabel="Days remaining to deadline"
            valueFormatter={(d) => `${d} days`}
            ariaLabel="Days from financial year end to accounts filing"
          />
        </div>
      )}

      {/* Stats Summary Grid */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-rule-soft pt-3.5 sm:grid-cols-3">
        <div>
          <p className="text-[11.5px] text-faint">Submission speed</p>
          <p className="mt-0.5 font-mono text-[13px] font-semibold text-ink">
            {latestDays !== null ? `${latestDays} days` : "Not recorded"}
          </p>
          <p className="mt-0.5 text-[10.5px] text-faint">
            {latestDays !== null
              ? `~${Math.round(latestDays / 30.4)} months post year-end`
              : "Bulk extract only"}
          </p>
        </div>

        <div>
          <p className="text-[11.5px] text-faint">Filing track record</p>
          <p className="mt-0.5 font-mono text-[13px] font-semibold text-ink">
            {totalWithFilingDate > 0
              ? `${totalWithFilingDate - lateCount} of ${totalWithFilingDate} on time`
              : "0 filings on record"}
          </p>
          <p className="mt-0.5 text-[10.5px] text-faint">
            {averageDays !== null ? `${averageDays}d multi-year avg.` : "Awaiting return extract"}
          </p>
        </div>

        <div className="col-span-2 sm:col-span-1">
          <p className="text-[11.5px] text-faint">Regulatory status</p>
          <p
            className={`mt-0.5 font-mono text-[13px] font-semibold ${
              isOverdue ? "text-stop" : "text-ink"
            }`}
          >
            {reportingStatus ?? (isOverdue ? "Overdue" : "Up to date")}
          </p>
          <p className="mt-0.5 text-[10.5px] text-faint">Charity Commission register</p>
        </div>
      </div>

      {/* Insight Note for CAMs */}
      <p className="mt-3 text-[12px] leading-[1.5] text-dim">
        <span className="font-semibold text-ink">Consulting context: </span>
        {insight}
      </p>
    </div>
  );
}
