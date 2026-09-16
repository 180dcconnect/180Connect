"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  /**
   * View-only: the row still shows its real colour at full strength, it just
   * cannot be changed and the drag handle is not drawn. Not `disabled` — that
   * greys the row out, which would hide the very thing a viewer is here to read.
   */
  readOnly?: boolean;
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
  /**
   * How fast the liquid catches the handle, as a fraction of the remaining gap
   * per frame (default 0.1). Lower is slower and more viscous — and the slower
   * it is, the longer the stretched droplet stays on screen to be seen.
   */
  gooChase?: number;
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
 * dragged — except for a read-only viewer, who gets the colours at full
 * strength with no handle and nothing to drag.
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
  readOnly = false,
  "aria-describedby": ariaDescribedBy,
  "aria-valuetext": ariaValueText,
  colorAt = getSankeyGradientColor,
  pitch = 8.5,
  stickWidth = 3,
  stickHeight = 18,
  gooChase = 0.1,
}: StickSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Where the liquid has got to, as opposed to where the handle is. It chases
  // the handle a frame at a time, and the capsule is drawn spanning the two, so
  // a drag stretches it and it settles back to a circle. Written straight to
  // the node rather than held in state — it changes every frame of a drag, and
  // nothing else in the row depends on it.
  const trailElRef = useRef<HTMLSpanElement>(null);
  const trailXRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

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
  // for it at the right end — at 100% it still lands inside the row. A viewer
  // has no handle, so the sticks take that space back and fill the full width.
  const handleSize = 18;
  const handleGap = 5;
  const handleSpace = readOnly ? 0 : handleGap + handleSize;

  // Same layout maths as HorizontalStickGauge, so the two read as one family.
  const effectiveWidth = width > 0 ? width : 600;
  const trackStart = stickWidth / 2;
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
      : trackStart + (activeCount - 1) * spacing + stickWidth / 2 + handleGap + handleSize / 2;

  useEffect(() => {
    if (readOnly) return;

    // The capsule spans from the handle back to where the liquid has got to.
    // It thins slightly as it stretches — liquid conserves itself — and at rest
    // the two ends coincide and it is exactly a circle on the handle.
    const paint = (x: number) => {
      const node = trailElRef.current;
      if (!node) return;
      const lag = Math.abs(handleX - x);
      const squash = 1 - (Math.min(lag, handleSize * 2) / (handleSize * 2)) * 0.18;
      const height = handleSize * squash;
      node.style.left = `${Math.min(handleX, x) - handleSize / 2}px`;
      node.style.width = `${lag + handleSize}px`;
      node.style.height = `${height}px`;
    };

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Reduced motion, and the first paint, put the liquid straight on the
    // handle — no droplet flies in from the left when the row opens.
    if (reduced || trailXRef.current === null) {
      trailXRef.current = handleX;
      paint(handleX);
      return;
    }

    const step = () => {
      const current = trailXRef.current ?? handleX;
      const distance = handleX - current;
      if (Math.abs(distance) < 0.4) {
        trailXRef.current = handleX;
        paint(handleX);
        frameRef.current = null;
        return;
      }
      trailXRef.current = current + distance * gooChase;
      paint(trailXRef.current);
      frameRef.current = requestAnimationFrame(step);
    };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [handleX, handleSize, gooChase, readOnly]);

  return (
    <div
      ref={containerRef}
      className={`group relative w-full rounded-inset has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-lead/30 has-[:focus-visible]:ring-offset-4 ${
        disabled && !readOnly ? "opacity-50" : ""
      }`}
    >
      <svg aria-hidden="true" className="block w-full overflow-visible" height={svgHeight}>
        {Array.from({ length: totalTicks }, (_, index) => {
          const active = index < activeCount;
          const x = trackStart + index * spacing;
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

      {/* The handle. One shape, not two: it is a capsule pinned at the handle and
          stretched back towards where it was dragged from, so a drag pulls it
          into a liquid streak and it settles back to a circle. An earlier take
          blurred two separate blobs together with an SVG goo filter, which
          necks and bulges on the way — that is what made it look lumpy.

          Positioned with `left`. A liquid-gooey wrapper was tried here too and
          it drives its own transform on the node, which pins the handle to the
          left edge of the row whatever the value — do not reintroduce it.

          Geometry is owned by the effect above, not by JSX: a drag re-renders
          this row on every pointer move, and a style prop here would snap the
          shape back to a circle each time, leaving no streak to see. */}
      {!readOnly && (
        <span
          ref={trailElRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-0 size-[18px] -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(12,16,20,0.3)]"
        />
      )}

      <input
        id={id}
        name={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled || readOnly}
        onChange={(event) => onValueChange(Number(event.target.value))}
        aria-describedby={ariaDescribedBy}
        aria-valuetext={ariaValueText}
        style={{ "--thumb-size": `${handleSize}px` } as CSSProperties}
        className="absolute inset-0 z-10 h-full w-full cursor-grab appearance-none opacity-0 active:cursor-grabbing disabled:cursor-default [&::-moz-range-thumb]:size-[var(--thumb-size)] [&::-moz-range-thumb]:border-0 [&::-webkit-slider-thumb]:size-[var(--thumb-size)] [&::-webkit-slider-thumb]:appearance-none"
      />
    </div>
  );
}
