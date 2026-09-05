"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";

export interface HorizontalStickGaugeProps {
  /** Number of items completed/checked. */
  checked: number;
  /** Total number of items. */
  total: number;
  /** Accessible label for screen readers. */
  ariaLabel?: string;
  /** Additional container styling. */
  className?: string;
  /** Active stick stroke color. Defaults to var(--lead). */
  activeColor?: string;
  /** Inactive stick stroke color. Defaults to var(--rule-soft). */
  inactiveColor?: string;
  /** Stick stroke color when hovering the inactive segment. Defaults to var(--faint). */
  hoverInactiveColor?: string;
  /** Target pitch (distance between stick centres) in px. Defaults to 8.5 (matching QueueQualityCard). */
  pitch?: number;
  /** Width (stroke width) of each vertical stick in px. Defaults to 3 (matching QueueQualityCard). */
  stickWidth?: number;
  /** Height of each stick in px. Defaults to 16. */
  stickHeight?: number;
  /** Whether to show the floating tooltip on hover. Defaults to true. */
  showTooltip?: boolean;
}

type HoverState = {
  x: number;
  segment: "checked" | "remaining";
};

export function HorizontalStickGauge({
  checked,
  total,
  ariaLabel = "Progress",
  className = "",
  activeColor = "var(--lead)",
  inactiveColor = "var(--rule-soft)",
  hoverInactiveColor = "var(--faint)",
  pitch = 8.5,
  stickWidth = 3,
  stickHeight = 16,
  showTooltip = true,
}: HorizontalStickGaugeProps) {
  const compId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(0);
  const [hasEnteredView, setHasEnteredView] = useState(false);
  const [hoverState, setHoverState] = useState<HoverState | null>(null);

  // Animated progress (0 to target active ticks count)
  const progressMotion = useMotionValue(0);
  const [displayProgress, setDisplayProgress] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    // Measure initial width
    const rect = node.getBoundingClientRect();
    if (rect.width > 0) {
      setWidth(rect.width);
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) {
        setWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(node);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasEnteredView(true);
          intersectionObserver.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    intersectionObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, []);

  const clampedTotal = Math.max(0, total);
  const clampedChecked = Math.max(0, Math.min(clampedTotal, checked));
  const remaining = Math.max(0, clampedTotal - clampedChecked);
  const pct = clampedTotal > 0 ? (clampedChecked / clampedTotal) * 100 : 0;

  // Layout calculations: evenly distribute sticks across the width
  const effectiveWidth = width > 0 ? width : 800;
  const availableWidth = Math.max(1, effectiveWidth - stickWidth);
  const intervals = Math.max(12, Math.round(availableWidth / pitch));
  const totalTicks = intervals + 1;
  const step = availableWidth / intervals;

  const targetTicksCount = useMemo(() => {
    if (clampedTotal === 0 || clampedChecked === 0) return 0;
    if (clampedChecked >= clampedTotal) return totalTicks;
    return Math.max(1, Math.min(totalTicks, Math.round((clampedChecked / clampedTotal) * totalTicks)));
  }, [clampedChecked, clampedTotal, totalTicks]);

  // Smooth gradual increasing animation
  useEffect(() => {
    if (!hasEnteredView) return;

    const currentVal = progressMotion.get();
    const delta = Math.abs(targetTicksCount - currentVal);
    // Smooth deceleration duration based on distance to travel
    const duration = Math.min(1.3, Math.max(0.6, (delta / Math.max(1, totalTicks)) * 2.0 + 0.5));

    const controls = animate(progressMotion, targetTicksCount, {
      duration,
      ease: [0.16, 1, 0.3, 1], // Smooth gradual deceleration
      onUpdate: (latest) => {
        setDisplayProgress(latest);
      },
    });

    return () => controls.stop();
  }, [targetTicksCount, totalTicks, hasEnteredView, progressMotion]);

  const ticks = useMemo(() => {
    const list = [];
    const y1 = 3;
    const y2 = 3 + stickHeight;

    for (let i = 0; i < totalTicks; i++) {
      const x = stickWidth / 2 + i * step;
      const isTargetActive = i < targetTicksCount;
      list.push({
        index: i,
        x,
        y1,
        y2,
        isTargetActive,
      });
    }
    return list;
  }, [totalTicks, stickWidth, step, stickHeight, targetTicksCount]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;

    // Threshold where checked ends and remaining begins
    const splitX = stickWidth / 2 + (targetTicksCount - 0.5) * step;
    const segment: "checked" | "remaining" =
      relativeX <= splitX && targetTicksCount > 0 ? "checked" : "remaining";

    setHoverState({
      x: relativeX,
      segment,
    });
  };

  const handlePointerLeave = () => {
    setHoverState(null);
  };

  const isHovered = hoverState !== null;
  const hoveredSegment = hoverState?.segment ?? null;

  const tooltipX = useMemo(() => {
    if (!hoverState) return 0;
    return Math.max(75, Math.min(effectiveWidth - 75, hoverState.x));
  }, [hoverState, effectiveWidth]);

  const svgHeight = stickHeight + 6;

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`relative w-full select-none ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      aria-valuetext={`${clampedChecked.toLocaleString()} of ${clampedTotal.toLocaleString()} clients checked (${pct.toFixed(1)}%)`}
    >
      <svg
        className="block w-full overflow-visible"
        height={svgHeight}
        style={{ height: svgHeight }}
        aria-hidden="true"
      >
        {/* Layer 1: Inactive track sticks (full height, base foundation) */}
        {ticks.map((tick) => {
          let baseStroke = inactiveColor;
          let opacity = hasEnteredView ? 1 : 0;
          let strokeW = stickWidth;

          if (isHovered) {
            if (hoveredSegment === "remaining" && !tick.isTargetActive) {
              baseStroke = hoverInactiveColor;
              strokeW = stickWidth + 0.5;
              opacity = 1;
            } else if (hoveredSegment === "checked" && !tick.isTargetActive) {
              opacity = 0.25;
            }
          }

          return (
            <line
              key={`base-tick-${compId}-${tick.index}`}
              x1={tick.x}
              y1={tick.y1}
              x2={tick.x}
              y2={tick.y2}
              stroke={baseStroke}
              strokeWidth={strokeW}
              strokeLinecap="round"
              opacity={opacity}
              className="transition-[stroke,stroke-width,opacity] duration-150"
            />
          );
        })}

        {/* Layer 2: Active sticks that gradually fill from left to right */}
        {ticks.map((tick) => {
          // Calculate fill progress for this individual stick (0 to 1)
          const fill = Math.min(1, Math.max(0, displayProgress - tick.index));
          if (fill <= 0) return null;

          const activeStroke = activeColor;
          let strokeW = stickWidth;
          let activeOpacity = Math.min(1, fill * 1.5);

          if (isHovered) {
            if (hoveredSegment === "checked" && tick.isTargetActive) {
              strokeW = stickWidth + 0.5;
              activeOpacity = 1;
            } else if (hoveredSegment === "remaining" && tick.isTargetActive) {
              activeOpacity = 0.25;
            }
          }

          const activeY2 = tick.y1 + Math.max(0.1, stickHeight * fill);

          return (
            <line
              key={`active-tick-${compId}-${tick.index}`}
              x1={tick.x}
              y1={tick.y1}
              x2={tick.x}
              y2={activeY2}
              stroke={activeStroke}
              strokeWidth={strokeW}
              strokeLinecap="round"
              opacity={activeOpacity}
              className="transition-[stroke,stroke-width,opacity] duration-150"
            />
          );
        })}
      </svg>

      {/* Floating tooltip on hover */}
      <AnimatePresence>
        {showTooltip && isHovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 3 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{ left: tooltipX }}
            className="pointer-events-none absolute -top-11 z-30 -translate-x-1/2 whitespace-nowrap rounded-panel border border-rule bg-white/95 px-2.5 py-1 text-[11px] shadow-[0_4px_14px_rgba(0,0,0,0.08)] backdrop-blur-md"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full"
                style={{
                  backgroundColor:
                    hoveredSegment === "checked" ? activeColor : hoverInactiveColor,
                }}
              />
              <span className="font-semibold text-ink">
                {hoveredSegment === "checked" ? "Checked" : "Still to check"}
              </span>
              <span className="font-mono tabular-nums text-dim">
                {hoveredSegment === "checked"
                  ? `${clampedChecked.toLocaleString()} (${pct.toFixed(1)}%)`
                  : `${remaining.toLocaleString()} (${(100 - pct).toFixed(1)}%)`}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
