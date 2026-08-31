import { StackedStickColumns } from "@/components/ui/stacked-stick-columns";

/**
 * F021/F022-F025 — a single platform-wide dashboard metric tile.
 *
 * The number is the tile. Label and caption are 11px, the value is 36px/900 —
 * the design system's "big type, small chrome" jump, with nothing in between.
 *
 * The right side displays the 7-day stacked sticks chart showing daily distribution.
 */
export function StatCard({
  label,
  value,
  share,
  caption,
  emphasis = false,
}: {
  label: string;
  value: number;
  /** 0–1. Drives the meter width only; the caption states it in words. */
  share: number;
  caption: string;
  emphasis?: boolean;
}) {
  const width = `${Math.round(Math.min(Math.max(share, 0), 1) * 100)}%`;

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
        {label}
      </p>

      <div className="mt-8 flex items-end justify-between gap-3">
        <p className="text-[2.25rem] font-black leading-none tracking-[-0.03em] tabular-nums text-foreground">
          {value.toLocaleString()}
        </p>

        <div className="shrink-0">
          <StackedStickColumns
            total={value > 0 ? value : 70}
            unit={label.toLowerCase()}
            activeColorClass={
              emphasis || label.toLowerCase().includes("converted")
                ? "bg-emerald-600 dark:bg-emerald-400"
                : label.toLowerCase().includes("response")
                  ? "bg-sky-500 dark:bg-sky-400"
                  : "bg-indigo-600 dark:bg-indigo-400"
            }
          />
        </div>
      </div>

      <div className="mt-4 border-t border-black/[0.04] pt-2.5 dark:border-white/[0.06]">
        <div
          aria-hidden="true"
          className="h-1 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]"
        >
          <div
            className={`h-full rounded-full ${emphasis ? "bg-brand" : "bg-black/25 dark:bg-white/40"}`}
            style={{ width }}
          />
        </div>
        <p className="mt-2 text-[11px] text-foreground/40">{caption}</p>
      </div>
    </div>
  );
}

export default StatCard;
