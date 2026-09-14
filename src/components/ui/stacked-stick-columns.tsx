"use client";

import { useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const MAX_STICKS = 10;

export interface StackedStickBucket {
  dateNumber: string;
  shortLabel: string;
  fullLabel?: string;
}

export interface StackedStickColumnsProps {
  /** Explicit 7-number array for the 7 days/intervals. */
  data?: number[];
  /** Custom unit/label for the tooltip, e.g. "emails", "replies", "conversions". */
  unit?: string;
  /** Active stick color class, e.g. "bg-slate-900 dark:bg-slate-100" or "bg-brand". */
  activeColorClass?: string;
  /** Explicit 7-bucket metadata for custom period subdivisions (e.g. 7 quadrants over 30 or 90 days). */
  buckets?: StackedStickBucket[];
  className?: string;
}

export function StackedStickColumns({
  data,
  unit = "",
  activeColorClass = "bg-foreground/85 dark:bg-foreground/90",
  buckets,
  className = "",
}: StackedStickColumnsProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hasEnteredView, setHasEnteredView] = useState(false);
  const compId = useId();

  // Generate date labels (use custom buckets if provided, or default to trailing 7 days)
  const dateMetadata = useMemo(() => {
    if (buckets && buckets.length === 7) return buckets;
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
  }, [buckets]);

  // Only display real daily/bucket data. If data is omitted, show zero sticks (never synthesize fake curves).
  const counts = useMemo(() => {
    if (data && data.length === 7) return data;
    return [0, 0, 0, 0, 0, 0, 0];
  }, [data]);

  const maxCount = Math.max(...counts, 1);

  return (
    <div
      className={`relative flex flex-col items-center select-none ${className}`}
      ref={(node) => {
        if (!node || hasEnteredView) return;
        const observer = new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting) {
            setHasEnteredView(true);
            observer.disconnect();
          }
        }, { threshold: 0.2 });
        observer.observe(node);
      }}
    >
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
                    animate={{ opacity: 1, y: -4, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.92 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="pointer-events-none absolute -top-7 z-50 whitespace-nowrap rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white shadow-md backdrop-blur-md dark:bg-white dark:text-slate-950"
                  >
                    {meta.shortLabel}: {val.toLocaleString()} {unit}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Vertical Stack of up to 10 Sticks (stacked bottom-to-top) — only reached bars show, the rest stay empty for the aesthetic */}
              <div className="flex h-[42px] flex-col-reverse justify-start gap-[1.5px] p-0.5 sm:h-[50px]">
                {Array.from({ length: stickCount }, (_, stickIdx) => {
                  return (
                    <motion.div
                      key={`stick-${stickIdx}`}
                      initial={{ opacity: 0, scaleY: 0, originY: 1 }}
                      animate={{
                        opacity: hasEnteredView ? (isHovered ? 1 : 0.85) : 0,
                        scaleY: hasEnteredView ? (isHovered ? 1.1 : 1) : 0,
                      }}
                      transition={{ duration: 0.18, delay: stickIdx * 0.01 }}
                      className={`h-[2.5px] w-[9px] sm:h-[3.5px] sm:w-[10px] rounded-[1px] transition-all ${activeColorClass}`}
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
