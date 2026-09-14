"use client";

import { useEffect, useRef, useState } from "react";
import { getSankeyGradientColor } from "@/components/ui/range-slider";

export interface StickSliderProps {
  id: string;
  /** Form field name — the slider is a real `<input type="range">`, so it submits. */
  name?: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-valuetext"?: string;
  /**
   * Colour for a position along the track, 0-1. Defaults to the Sankey ramp:
   * brick red at the low end, through amber and lime, to deep forest green.
   */
  colorAt?: (ratio: number) => string;
  /** Distance between stick centres in px. Matches HorizontalStickGauge. */
  pitch?: number;
  stickWidth?: number;
  stickHeight?: number;
}

/**
 * A slider drawn as `HorizontalStickGauge`'s sticks.
 *
 * The sticks are decoration over a real range input stretched invisibly across
 * them, so dragging, clicking the track, arrow keys, touch and screen readers all
 * behave exactly like a native slider — nothing about input is reimplemented.
 *
 * Every filled stick takes the colour of the current position on the ramp, and
 * the stroke transitions, so dragging right fades the whole fill from red through
 * amber into green rather than stepping between colours. A plain white round
 * handle sits just past the last filled stick, so it is obvious the row can be
 * dragged.
 */
export function StickSlider({
  id,
  name,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  "aria-describedby": ariaDescribedBy,
  "aria-valuetext": ariaValueText,
  colorAt = getSankeyGradientColor,
  pitch = 8.5,
  stickWidth = 3,
  stickHeight = 18,
}: StickSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const range = max - min;
  const ratio = range > 0 ? Math.max(0, Math.min(1, (value - min) / range)) : 0;

  // The handle sits just past the last filled stick, so the sticks leave room
  // for it at the right end — at 100% it still lands inside the row.
  const handleSize = 18;
  const handleGap = 5;
  const handleSpace = handleGap + handleSize;

  // Same layout maths as HorizontalStickGauge, so the two read as one family.
  const effectiveWidth = width > 0 ? width : 600;
  const available = Math.max(1, effectiveWidth - stickWidth - handleSpace);
  const intervals = Math.max(12, Math.round(available / pitch));
  const totalTicks = intervals + 1;
  const spacing = available / intervals;
  const activeCount = ratio === 0 ? 0 : Math.max(1, Math.round(ratio * totalTicks));

  const top = 3;
  const svgHeight = stickHeight + 6;
  const fill = colorAt(ratio);
  // Centre of the handle: just to the right of the last filled stick, or at the
  // very start of the row when nothing is filled.
  const handleX =
    activeCount === 0
      ? handleSize / 2
      : stickWidth / 2 + (activeCount - 1) * spacing + stickWidth / 2 + handleGap + handleSize / 2;

  return (
    <div
      ref={containerRef}
      className={`group relative w-full rounded-inset has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-lead/30 has-[:focus-visible]:ring-offset-4 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <svg aria-hidden="true" className="block w-full overflow-visible" height={svgHeight}>
        {Array.from({ length: totalTicks }, (_, index) => {
          const active = index < activeCount;
          const x = stickWidth / 2 + index * spacing;
          return (
            <line
              key={index}
              x1={x}
              x2={x}
              y1={top}
              y2={top + stickHeight}
              stroke={active ? fill : "var(--rule-soft)"}
              strokeWidth={stickWidth}
              strokeLinecap="round"
              className="transition-[stroke] duration-300 ease-out motion-reduce:transition-none"
            />
          );
        })}
      </svg>

      {/* The handle. Sticks alone do not say "drag me"; a round thumb is the one
          shape everyone already reads as a slider. Decorative — the invisible
          input underneath is what is actually dragged — so it ignores the pointer. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(12,16,20,0.3)] transition-transform duration-150 ease-out group-active:scale-110 motion-reduce:transition-none"
        style={{ left: handleX, width: handleSize, height: handleSize }}
      />

      <input
        id={id}
        name={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(Number(event.target.value))}
        aria-describedby={ariaDescribedBy}
        aria-valuetext={ariaValueText}
        className="absolute inset-0 h-full w-full cursor-grab appearance-none opacity-0 active:cursor-grabbing disabled:cursor-default"
      />
    </div>
  );
}
