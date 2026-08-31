"use client";

import { useId, useMemo, useState } from "react";
import { Target } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Queue quality — the LATEST_SCORES band distribution (F058/F059), read by
 * every role (matrix §3.6). This replaces the "Customer Segmentation"
 * placeholder: the dial and rows are the same component shape, but the
 * segments are now the real high/medium/low bands the client list filters on,
 * and the per-row figure is the band's share of the scored queue rather than a
 * decorative percentage. Scoring is system-run, so this card is team-wide by
 * definition and takes no per-person scope.
 */

export type QueueBands = { high: number; medium: number; low: number };

export interface QueueQualityCardProps {
  bands: QueueBands;
  /** Organisations with a band — the dial's total. */
  scored: number;
  /** Every organisation in the pipeline, so the unscored remainder can show. */
  totalOrgs: number;
  className?: string;
}

type Segment = {
  id: string;
  name: string;
  value: number;
  color: string;
  meta: string;
};

const TOTAL_TICKS = 42;
const START_ANGLE_DEG = 135; // Bottom-left
const SWEEP_ANGLE_DEG = 270; // 270 degree arc leaving open bottom-left/bottom

export function QueueQualityCard({ bands, scored, totalOrgs, className = "" }: QueueQualityCardProps) {
  const cardId = useId().replace(/:/g, "");
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);

  const segments = useMemo<Segment[]>(() => {
    const build = (id: string, name: string, value: number, color: string): Segment => ({
      id,
      name,
      value,
      color,
      meta: scored > 0 ? `${Math.round((value / scored) * 100)}% of scored` : "—",
    });
    return [
      build("high", "High priority", bands.high, "#0f172a"),
      build("medium", "Medium priority", bands.medium, "#64748b"),
      build("low", "Low priority", bands.low, "#cbd5e1"),
    ];
  }, [bands, scored]);

  // Only bands with a value get ticks/bars — single-band 100% shows only that bar.
  const visibleSegments = useMemo(() => {
    const filtered = segments.filter((s) => s.value > 0);
    return filtered.length ? filtered : segments;
  }, [segments]);

  const unscored = Math.max(totalOrgs - scored, 0);

  // Compute tick ranges per segment
  const ticks = useMemo(() => {
    const totalVal = visibleSegments.reduce((sum, s) => sum + s.value, 0) || 1;
    const segmentRanges: { segment: Segment; startTick: number; endTick: number }[] = [];
    let currentAcc = 0;
    for (const seg of visibleSegments) {
      const startPct = currentAcc / totalVal;
      const nextAcc = currentAcc + seg.value;
      const endPct = nextAcc / totalVal;
      segmentRanges.push({
        segment: seg,
        startTick: Math.round(startPct * TOTAL_TICKS),
        endTick: Math.round(endPct * TOTAL_TICKS),
      });
      currentAcc = nextAcc;
    }

    const result = [];
    const cx = 100;
    const cy = 100;
    const r1 = 68; // inner radius
    const r2 = 84; // outer radius

    for (let i = 0; i < TOTAL_TICKS; i++) {
      const fraction = i / (TOTAL_TICKS - 1);
      const angleDeg = START_ANGLE_DEG + fraction * SWEEP_ANGLE_DEG;
      const angleRad = (angleDeg * Math.PI) / 180;

      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);

      const x1 = cx + r1 * cos;
      const y1 = cy + r1 * sin;
      const x2 = cx + r2 * cos;
      const y2 = cy + r2 * sin;

      // Find which segment this tick belongs to
      let tickSegment = segmentRanges[0].segment;
      for (const range of segmentRanges) {
        if (i >= range.startTick && i <= range.endTick) {
          tickSegment = range.segment;
          break;
        }
      }

      result.push({
        index: i,
        x1,
        y1,
        x2,
        y2,
        segment: tickSegment,
      });
    }
    return result;
  }, [visibleSegments]);

  const activeSegment = useMemo(() => {
    return visibleSegments.find((s) => s.id === hoveredSegmentId) ?? visibleSegments[0];
  }, [visibleSegments, hoveredSegmentId]);

  return (
    <div
      className={`relative flex w-full flex-col justify-between overflow-hidden rounded-[28px] border border-border bg-card p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all ${className}`}
    >
      {/* Top Header */}
      <div>
        <div className="flex items-center gap-2.5 pb-4 border-b border-black/[0.06] dark:border-white/[0.08]">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/[0.04] text-foreground dark:bg-white/[0.08]">
            <Target size={16} strokeWidth={2.2} className="opacity-80" />
          </div>
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">Queue quality</h3>
        </div>

        {scored === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 py-12 text-center">
            <p className="text-sm font-medium text-foreground">No scored clients yet</p>
            <p className="text-xs text-muted-foreground">
              Bands appear once the scoring run has classified clients.
            </p>
          </div>
        ) : (
          <>
            {/* Center Radial Meter Area */}
            <div className="relative mx-auto mt-4 flex aspect-square w-full max-w-[260px] items-center justify-center">
              <svg
                viewBox="0 0 200 200"
                className="h-full w-full select-none overflow-visible"
                aria-hidden="true"
              >
                {ticks.map((tick) => {
                  const isSegmentActive = activeSegment.id === tick.segment.id;
                  const isAnyHovered = hoveredSegmentId !== null;

                  const opacity = !isAnyHovered ? 1 : isSegmentActive ? 1 : 0;

                  return (
                    <motion.line
                      key={`tick-${cardId}-${tick.index}`}
                      x1={tick.x1}
                      y1={tick.y1}
                      x2={tick.x2}
                      y2={tick.y2}
                      stroke={tick.segment.color}
                      strokeWidth={3}
                      strokeLinecap="round"
                      animate={{
                        opacity,
                        strokeWidth: isSegmentActive && isAnyHovered ? 3.5 : 3,
                      }}
                      transition={{ duration: 0.2 }}
                      className="transition-all duration-150"
                      onPointerEnter={() => setHoveredSegmentId(tick.segment.id)}
                      onPointerLeave={() => setHoveredSegmentId(null)}
                    />
                  );
                })}
              </svg>

              {/* Center Info Ring / Pill */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.04] text-foreground/75 dark:bg-white/[0.08]">
                  <Target size={16} strokeWidth={2.2} />
                </div>
                <span className="mt-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  Scored
                </span>
                <span className="text-[26px] font-bold leading-none tracking-tight text-foreground">
                  {scored.toLocaleString()}
                </span>
              </div>

              {/* Floating Tooltip positioned near the active segment */}
              <AnimatePresence>
                {hoveredSegmentId && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 4 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="pointer-events-none absolute right-0 bottom-8 z-30 min-w-[130px] rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-popover/95 px-3 py-2 shadow-[0_8px_20px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.06)] backdrop-blur-md"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: activeSegment.color }} />
                      <span className="text-[12px] font-bold text-foreground">{activeSegment.name}</span>
                    </div>
                    <div className="mt-1 text-[13px] font-semibold tabular-nums">
                      <span className="text-foreground">{activeSegment.value.toLocaleString()}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Breakdown Rows List — only non-zero bands get a row */}
            <div className="mt-4 space-y-2 border-t border-black/[0.04] pt-4 dark:border-white/[0.06]">
              {visibleSegments.map((seg) => {
                const isHovered = hoveredSegmentId === seg.id;
                return (
                  <div
                    key={seg.id}
                    className={`flex items-center justify-between rounded-xl px-2.5 py-1.5 transition-colors cursor-pointer ${
                      isHovered ? "bg-black/[0.04] dark:bg-white/[0.06]" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                    }`}
                    onPointerEnter={() => setHoveredSegmentId(seg.id)}
                    onPointerLeave={() => setHoveredSegmentId(null)}
                  >
                    {/* Left indicator + name */}
                    <div className="flex items-center gap-2.5">
                      <span className="h-4 w-1.5 rounded-full" style={{ background: seg.color }} />
                      <span className="text-[13px] font-medium text-foreground">{seg.name}</span>
                    </div>

                    {/* Right: count + share of the scored queue */}
                    <div className="flex items-center gap-3 text-[13px] font-semibold tabular-nums">
                      <span className="text-foreground font-bold">{seg.value.toLocaleString()}</span>
                      <span className="text-[12px] font-medium text-muted-foreground">{seg.meta}</span>
                    </div>
                  </div>
                );
              })}

              {unscored > 0 && (
                <div className="flex items-center justify-between px-2.5 pt-1">
                  <span className="text-[12px] text-muted-foreground">Not yet scored</span>
                  <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">
                    {unscored.toLocaleString()} of {totalOrgs.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default QueueQualityCard;
