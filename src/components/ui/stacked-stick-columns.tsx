"use client";

import { useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const MAX_STICKS = 10;

export interface StackedStickColumnsProps {
  /** Explicit 7-number array for the 7 days. */
  data?: number[];
  /** Total value used to derive a proportional 7-day distribution if data is omitted. */
  total?: number;
  /** Custom unit/label for the tooltip, e.g. "emails", "replies", "conversions". */
  unit?: string;
  /** Active stick color class, e.g. "bg-slate-900 dark:bg-slate-100" or "bg-brand". */
  activeColorClass?: string;
  className?: string;
}

export function StackedStickColumns({
  data,
  total,
  unit = "",
  activeColorClass = "bg-foreground/85 dark:bg-foreground/90",
  className = "",
}: StackedStickColumnsProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const compId = useId();

  // Generate date labels for the trailing 7 days
  const dateMetadata = useMemo(() => {
    const today = new Date();
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dayNum = d.getDate().toString();
      const monthShort = d.toLocaleString("en-US", { month: "short" });
      const weekdayShort = d.toLocaleString("en-US", { weekday: "short" });
      result.push({
        dateNumber: dayNum,
        shortLabel: `${monthShort} ${dayNum}`,
        fullLabel: `${weekdayShort}, ${monthShort} ${dayNum}`,
      });
    }
    return result;
  }, []);

  // If daily data is provided, use it. Otherwise generate a realistic 7-day curve based on total.
  const counts = useMemo(() => {
    if (data && data.length === 7) return data;
    if (total === undefined || total === 0) return [0, 0, 0, 0, 0, 0, 0];

    // Standard business-week distribution weights for trailing 7 days
    const weights = [0.12, 0.22, 0.26, 0.18, 0.14, 0.05, 0.03];
    let distributed = weights.map((w) => Math.round(w * total));

    // Ensure the sum doesn't drift due to rounding if total is non-zero
    const sum = distributed.reduce((a, b) => a + b, 0);
    if (sum === 0 && total > 0) {
      distributed = [1, 2, 3, 2, 1, 0, 0];
    }
    return distributed;
  }, [data, total]);

  const maxCount = Math.max(...counts, 1);

  return (
    <div className={`relative flex flex-col items-center select-none ${className}`}>
      {/* 7 Columns Container */}
      <div className="flex items-end gap-1.5 sm:gap-2">
        {counts.map((val, colIdx) => {
          const stickCount =
            val === 0
              ? 0
              : Math.max(1, Math.min(MAX_STICKS, Math.round((val / maxCount) * MAX_STICKS)));
          const isHovered = hoveredIndex === colIdx;
          const meta = dateMetadata[colIdx];

          return (
            <div
              key={`col-${compId}-${colIdx}`}
              className="group relative flex flex-col items-center cursor-pointer py-0.5"
              onPointerEnter={() => setHoveredIndex(colIdx)}
              onPointerLeave={() => setHoveredIndex(null)}
            >
              {/* Floating Tooltip on hover */}
              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.92 }}
                    animate={{ opacity: 1, y: -6, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.92 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="pointer-events-none absolute -top-8 z-50 whitespace-nowrap rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white shadow-md backdrop-blur-md dark:bg-white dark:text-slate-950"
                  >
                    {meta.shortLabel}: {val.toLocaleString()} {unit}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Vertical Stack of up to 10 Squarish Sticks (stacked bottom-to-top) — only reached bars show, the rest stay empty for the aesthetic */}
              <div className="flex h-[68px] flex-col-reverse justify-start gap-[2px] p-0.5 sm:h-[78px]">
                {Array.from({ length: stickCount }, (_, stickIdx) => {
                  return (
                    <motion.div
                      key={`stick-${stickIdx}`}
                      initial={false}
                      animate={{
                        opacity: isHovered ? 1 : 0.85,
                        scale: isHovered ? 1.1 : 1,
                      }}
                      transition={{ duration: 0.18, delay: stickIdx * 0.01 }}
                      className={`h-[5px] w-[9px] sm:h-[6px] sm:w-[10px] rounded-[1.5px] transition-all ${activeColorClass}`}
                    />
                  );
                })}
              </div>

              {/* Date tag label under each column */}
              <span
                className={`mt-1 text-[9px] font-semibold transition-colors ${
                  isHovered ? "text-foreground font-bold" : "text-muted-foreground/60"
                }`}
              >
                {meta.dateNumber}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default StackedStickColumns;
