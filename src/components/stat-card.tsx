"use client";

import type { ReactNode } from "react";
import { StackedStickColumns } from "@/components/ui/stacked-stick-columns";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";

/**
 * F021/F022-F025 — a single platform-wide dashboard metric tile.
 *
 * The number is the tile. Label and caption are 11px, the value is 36px/900 —
 * the design system's "big type, small chrome" jump, with nothing in between.
 *
 * The right side displays the 7-day stacked sticks chart showing daily distribution.
 * The bottom uses HorizontalStickGauge to display pipeline share with no border.
 */
export function StatCard({
  label,
  value,
  share,
  caption,
  data,
  total,
  checked,
  showGauge,
  gaugeColor,
  footerBadge,
  emphasis = false,
}: {
  label: string;
  value: number;
  /** 0–1. Drives the meter width only; the caption states it in words. */
  share: number;
  caption: string;
  data?: number[];
  total?: number;
  checked?: number;
  showGauge?: boolean;
  gaugeColor?: string;
  footerBadge?: ReactNode;
  emphasis?: boolean;
}) {
  const isResponse =
    label.toLowerCase().includes("response") || label.toLowerCase().includes("repl");
  const isConverted =
    emphasis || label.toLowerCase().includes("converted");

  const shouldShowGauge = showGauge !== undefined ? showGauge : !isResponse;

  const calculatedTotal =
    total !== undefined
      ? total
      : share > 0
        ? Math.round(value / share)
        : 0;

  const calculatedChecked =
    checked !== undefined
      ? checked
      : total !== undefined
        ? Math.min(value, calculatedTotal)
        : Math.round(share * calculatedTotal);

  return (
    <div className="relative hover:z-30 focus-within:z-30 flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-card">
      <p className="font-body text-[20px] font-semibold capitalize tracking-[-0.02em] text-ink">
        {label}
      </p>

      <div className="mt-8 flex items-end justify-between gap-3">
        <p className="text-[2.25rem] font-black leading-none tracking-[-0.03em] tabular-nums text-foreground">
          {value.toLocaleString()}
        </p>

        <div className="shrink-0">
          <StackedStickColumns
            data={data}
            unit={label.toLowerCase()}
            activeColorClass={
              isConverted
                ? "bg-converted"
                : isResponse
                  ? "bg-lead"
                  : "bg-indigo-600 dark:bg-indigo-400"
            }
          />
        </div>
      </div>

      <div className="mt-4">
        {footerBadge ? (
          <div className="flex items-center min-h-[16px]">{footerBadge}</div>
        ) : shouldShowGauge && calculatedTotal > 0 ? (
          <HorizontalStickGauge
            checked={calculatedChecked}
            total={calculatedTotal}
            pitch={8.5}
            stickWidth={3}
            stickHeight={14}
            activeColor={
              gaugeColor ??
              (isConverted ? "var(--converted, #067647)" : "var(--lead, #23407a)")
            }
            inactiveColor="var(--rule-soft)"
            hoverInactiveColor="var(--faint)"
            checkedLabel={label}
            remainingLabel="Remaining pipeline"
            ariaLabel={`${label} percentage of pipeline`}
            valueFormatter={(v) => `${v.toLocaleString()} orgs`}
            showTooltip
          />
        ) : null}
        <p className="mt-2 text-[11px] text-foreground/40 font-body">{caption}</p>
      </div>
    </div>
  );
}

export default StatCard;
