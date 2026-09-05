"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";

export interface StickGaugeSegment {
  id?: string;
  label: string;
  value: number;
  color: string;
  hoverColor?: string;
}

export interface HorizontalStickGaugeProps {
  /** Optional multi-segment configuration. Takes precedence over checked/total. */
  segments?: StickGaugeSegment[];
  /** Number of items completed/checked (when segments not provided). */
  checked?: number;
  /** Total number of items (when segments not provided). */
  total?: number;
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
  /** Label for the active/checked segment in the tooltip. Defaults to "Checked". */
  checkedLabel?: string;
  /** Label for the inactive/remaining segment in the tooltip. Defaults to "Still to check". */
  remainingLabel?: string;
  /** Formatter for values in the tooltip. Defaults to .toLocaleString(). */
  valueFormatter?: (value: number) => string;
  /** Optional custom accessible value text for screen readers. */
  ariaValueText?: string;
}

type HoverState = {
  x: number;
  segmentIndex: number;
  segmentLabel: string;
  segmentValue: number;
  segmentPct: number;
  segmentColor: string;
};

export function HorizontalStickGauge({
  segments,
  checked = 0,
  total = 0,
  ariaLabel = "Progress",
  ariaValueText,
  className = "",
  activeColor = "var(--lead)",
  inactiveColor = "var(--rule-soft)",
  hoverInactiveColor = "var(--faint)",
  pitch = 8.5,
  stickWidth = 3,
  stickHeight = 16,
  showTooltip = true,
  checkedLabel = "Checked",
  remainingLabel = "Still to check",
  valueFormatter = (v) => v.toLocaleString(),
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

  const hasSegments = Boolean(segments && segments.length > 0);

  // Layout calculations: evenly distribute sticks across the width
  const effectiveWidth = width > 0 ? width : 800;
  const availableWidth = Math.max(1, effectiveWidth - stickWidth);
  const intervals = Math.max(12, Math.round(availableWidth / pitch));
  const totalTicks = intervals + 1;
  const step = availableWidth / intervals;

  // Single-metric mode calculations
  const clampedTotal = Math.max(0, total);
  const clampedChecked = Math.max(0, Math.min(clampedTotal, checked));
  const remaining = Math.max(0, clampedTotal - clampedChecked);
  const singlePct = clampedTotal > 0 ? (clampedChecked / clampedTotal) * 100 : 0;

  // Multi-segment mode calculations
  const totalSegmentsValue = useMemo(() => {
    if (!hasSegments || !segments) return 0;
    return segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  }, [hasSegments, segments]);

  const tickToSegmentIndex = useMemo(() => {
    if (!hasSegments || !segments || totalSegmentsValue <= 0) return [];
    const rawCounts = segments.map((s) => (Math.max(0, s.value) / totalSegmentsValue) * totalTicks);
    const floorCounts = rawCounts.map((rc, idx) => ({
      idx,
      count: Math.floor(rc),
      remainder: rc - Math.floor(rc),
      positive: (segments[idx]?.value ?? 0) > 0,
    }));
    const positiveCount = floorCounts.filter((f) => f.positive).length;
    if (totalTicks >= positiveCount) {
      floorCounts.forEach((f) => {
        if (f.positive && f.count === 0) {
          f.count = 1;
        }
      });
    }
    const sumAssigned = floorCounts.reduce((acc, f) => acc + f.count, 0);
    if (sumAssigned > totalTicks) {
      const sorted = [...floorCounts].sort((a, b) => b.count - a.count);
      let excess = sumAssigned - totalTicks;
      for (const item of sorted) {
        if (excess <= 0) break;
        if (item.count > 1) {
          const drop = Math.min(excess, item.count - 1);
          item.count -= drop;
          excess -= drop;
        }
      }
    } else if (sumAssigned < totalTicks) {
      const sorted = [...floorCounts].sort((a, b) => b.remainder - a.remainder);
      let diff = totalTicks - sumAssigned;
      for (const item of sorted) {
        if (diff <= 0) break;
        item.count += 1;
        diff -= 1;
      }
    }

    const mapping: number[] = [];
    floorCounts.forEach((f) => {
      for (let k = 0; k < f.count; k++) {
        mapping.push(f.idx);
      }
    });
    while (mapping.length < totalTicks) {
      mapping.push(Math.max(0, segments.length - 1));
    }
    return mapping;
  }, [hasSegments, segments, totalSegmentsValue, totalTicks]);

  const targetTicksCount = useMemo(() => {
    if (hasSegments) return totalTicks;
    if (clampedTotal === 0 || clampedChecked === 0) return 0;
    if (clampedChecked >= clampedTotal) return totalTicks;
    return Math.max(1, Math.min(totalTicks, Math.round((clampedChecked / clampedTotal) * totalTicks)));
  }, [hasSegments, clampedChecked, clampedTotal, totalTicks]);

  // Smooth gradual increasing animation
  useEffect(() => {
    if (!hasEnteredView) return;

    const currentVal = progressMotion.get();
    const delta = Math.abs(targetTicksCount - currentVal);
    const duration = Math.min(1.3, Math.max(0.6, (delta / Math.max(1, totalTicks)) * 2.0 + 0.5));

    const controls = animate(progressMotion, targetTicksCount, {
      duration,
      ease: [0.16, 1, 0.3, 1],
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

    if (hasSegments && segments && segments.length > 0) {
      const tickIndex = Math.max(0, Math.min(totalTicks - 1, Math.round((relativeX - stickWidth / 2) / step)));
      const segIndex = tickToSegmentIndex[tickIndex] ?? 0;
      const seg = segments[segIndex];
      if (seg) {
        const segPct = totalSegmentsValue > 0 ? (seg.value / totalSegmentsValue) * 100 : 0;
        setHoverState({
          x: relativeX,
          segmentIndex: segIndex,
          segmentLabel: seg.label,
          segmentValue: seg.value,
          segmentPct: segPct,
          segmentColor: seg.color,
        });
      }
      return;
    }

    // Default 2-segment mode (checked / remaining)
    const splitX = stickWidth / 2 + (targetTicksCount - 0.5) * step;
    const isChecked = relativeX <= splitX && targetTicksCount > 0;
    setHoverState({
      x: relativeX,
      segmentIndex: isChecked ? 0 : 1,
      segmentLabel: isChecked ? checkedLabel : remainingLabel,
      segmentValue: isChecked ? clampedChecked : remaining,
      segmentPct: isChecked ? singlePct : 100 - singlePct,
      segmentColor: isChecked
        ? activeColor
        : hoverInactiveColor !== "var(--faint)"
          ? hoverInactiveColor
          : inactiveColor,
    });
  };

  const handlePointerLeave = () => {
    setHoverState(null);
  };

  const isHovered = hoverState !== null;
  const hoveredSegmentIndex = hoverState?.segmentIndex ?? null;

  const tooltipX = useMemo(() => {
    if (!hoverState) return 0;
    return Math.max(75, Math.min(effectiveWidth - 75, hoverState.x));
  }, [hoverState, effectiveWidth]);

  const svgHeight = stickHeight + 6;

  const ariaValueNow = Math.round(hasSegments ? 100 : singlePct);
  const defaultAriaValueText = hasSegments
    ? segments?.map((s) => `${s.label}: ${valueFormatter(s.value)}`).join(", ")
    : `${valueFormatter(clampedChecked)} of ${valueFormatter(clampedTotal)} (${singlePct.toFixed(1)}%)`;

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`relative w-full select-none ${className}`}
      role="progressbar"
      aria-valuenow={ariaValueNow}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      aria-valuetext={ariaValueText ?? defaultAriaValueText}
    >
      <svg
        className="block w-full overflow-visible"
        height={svgHeight}
        style={{ height: svgHeight }}
        aria-hidden="true"
      >
        {hasSegments && segments ? (
          // Multi-segment rendering
          ticks.map((tick) => {
            const segIdx = tickToSegmentIndex[tick.index] ?? 0;
            const seg = segments[segIdx];
            if (!seg) return null;

            const isThisSegHovered = hoveredSegmentIndex === segIdx;
            const hasAnyHover = isHovered;
            const stroke = isThisSegHovered && seg.hoverColor ? seg.hoverColor : seg.color;
            const strokeW = isThisSegHovered ? stickWidth + 0.5 : stickWidth;
            const opacity = hasAnyHover ? (isThisSegHovered ? 1 : 0.3) : 1;

            const fill = Math.min(1, Math.max(0, displayProgress - tick.index));
            if (fill <= 0) return null;
            const activeY2 = tick.y1 + Math.max(0.1, stickHeight * fill);

            return (
              <line
                key={`seg-tick-${compId}-${tick.index}`}
                x1={tick.x}
                y1={tick.y1}
                x2={tick.x}
                y2={activeY2}
                stroke={stroke}
                strokeWidth={strokeW}
                strokeLinecap="round"
                opacity={opacity}
                className="transition-[stroke,stroke-width,opacity] duration-150"
              />
            );
          })
        ) : (
          // Default 2-layer rendering (checked / remaining)
          <>
            {/* Layer 1: Inactive track sticks */}
            {ticks.map((tick) => {
              let baseStroke = tick.isTargetActive ? "var(--rule-soft)" : inactiveColor;
              let opacity = hasEnteredView ? 1 : 0;
              let strokeW = stickWidth;

              if (isHovered) {
                if (hoveredSegmentIndex === 1 && !tick.isTargetActive) {
                  baseStroke = hoverInactiveColor;
                  strokeW = stickWidth + 0.5;
                  opacity = 1;
                } else if (hoveredSegmentIndex === 0 && !tick.isTargetActive) {
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

            {/* Layer 2: Active sticks */}
            {ticks.map((tick) => {
              const fill = Math.min(1, Math.max(0, displayProgress - tick.index));
              if (fill <= 0) return null;

              const activeStroke = activeColor;
              let strokeW = stickWidth;
              let activeOpacity = Math.min(1, fill * 1.5);

              if (isHovered) {
                if (hoveredSegmentIndex === 0 && tick.isTargetActive) {
                  strokeW = stickWidth + 0.5;
                  activeOpacity = 1;
                } else if (hoveredSegmentIndex === 1 && tick.isTargetActive) {
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
          </>
        )}
      </svg>

      {/* Floating tooltip on hover */}
      <AnimatePresence>
        {showTooltip && isHovered && hoverState && (
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
                style={{ backgroundColor: hoverState.segmentColor }}
              />
              <span className="font-semibold text-ink">
                {hoverState.segmentLabel}
              </span>
              <span className="font-mono tabular-nums text-dim">
                {valueFormatter(hoverState.segmentValue)} ({hoverState.segmentPct.toFixed(1)}%)
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
