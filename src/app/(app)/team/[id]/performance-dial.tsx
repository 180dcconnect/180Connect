"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const TOTAL_TICKS = 72;
const START_ANGLE_DEG = -90;
const R_INNER = 70;
const R_OUTER = 88;

type PipelineRun = {
  key: "won" | "in_progress" | "discovery" | "closed";
  label: string;
  count: number;
  colour: string;
  percent: number;
  start: number;
  end: number;
};

export function PerformanceDial({
  totalClients,
  convertedCount,
  inProgressCount,
  discoveryCount,
  closedCount,
}: {
  totalClients: number;
  convertedCount: number;
  inProgressCount: number;
  discoveryCount: number;
  closedCount: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const conversionRate = totalClients > 0 ? (convertedCount / totalClients) * 100 : 0;

  const runs: PipelineRun[] = useMemo(() => {
    if (totalClients === 0) return [];

    const segments: { key: PipelineRun["key"]; label: string; count: number; colour: string }[] = [
      { key: "won", label: "Won Clients", count: convertedCount, colour: "#3d7a2e" }, // --go
      { key: "in_progress", label: "Active Outreach", count: inProgressCount, colour: "#35589b" }, // --lead
      { key: "discovery", label: "Discovery", count: discoveryCount, colour: "#667080" }, // --dim
      { key: "closed", label: "Closed / Stalled", count: closedCount, colour: "#a83838" }, // --stop
    ];

    let cursor = 0;
    const out: PipelineRun[] = [];

    for (const seg of segments) {
      if (seg.count === 0) continue;
      const share = seg.count / totalClients;
      const start = cursor;
      cursor = start + share;
      out.push({
        key: seg.key,
        label: seg.label,
        count: seg.count,
        colour: seg.colour,
        percent: share * 100,
        start,
        end: cursor,
      });
    }

    return out;
  }, [totalClients, convertedCount, inProgressCount, discoveryCount, closedCount]);

  const ticks = useMemo(() => {
    const out = [];
    for (let index = 0; index < TOTAL_TICKS; index += 1) {
      const fraction = index / TOTAL_TICKS;
      const run = runs.find((c) => fraction >= c.start && fraction < c.end);
      if (!run) continue;
      const angle = ((START_ANGLE_DEG + fraction * 360) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      out.push({
        index,
        runKey: run.key,
        colour: run.colour,
        x1: Math.round((100 + R_INNER * cos) * 1000) / 1000,
        y1: Math.round((100 + R_INNER * sin) * 1000) / 1000,
        x2: Math.round((100 + R_OUTER * cos) * 1000) / 1000,
        y2: Math.round((100 + R_OUTER * sin) * 1000) / 1000,
      });
    }
    return out;
  }, [runs]);

  const activeRun = hovered ? runs.find((r) => r.key === hovered) : null;

  return (
    <div className="flex min-h-0 shrink-0 flex-col items-center justify-center gap-1.5">
      <div
        className="relative aspect-square w-[170px] max-w-full @container"
        role="img"
        aria-label={
          totalClients === 0
            ? "No clients assigned yet"
            : `Conversion rate: ${conversionRate.toFixed(1)}%, with ${convertedCount} won of ${totalClients} clients.`
        }
      >
        <svg viewBox="0 0 200 200" className="size-full select-none">
          {ticks.map((tick) => {
            const visible = hovered === null || tick.runKey === hovered;
            return (
              <g key={tick.index}>
                <line
                  x1={tick.x1}
                  y1={tick.y1}
                  x2={tick.x2}
                  y2={tick.y2}
                  stroke={tick.colour}
                  strokeWidth={3.8}
                  strokeLinecap="butt"
                  className="transition-opacity duration-150"
                  style={{ opacity: visible ? 1 : 0 }}
                />
                <line
                  x1={tick.x1}
                  y1={tick.y1}
                  x2={tick.x2}
                  y2={tick.y2}
                  stroke="transparent"
                  strokeWidth={14}
                  onPointerEnter={() => setHovered(tick.runKey)}
                  onPointerLeave={() => setHovered(null)}
                />
              </g>
            );
          })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {totalClients === 0 ? (
            <>
              <span className="font-mono text-[18cqw] leading-none font-medium text-faint tabular-nums">
                0
              </span>
              <span className="mt-1.5 max-w-[6.5rem] text-[6.5cqw] leading-[1.3] font-medium text-faint">
                No clients
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-[22cqw] leading-none font-medium tracking-[-0.03em] text-ink tabular-nums">
                {conversionRate.toFixed(1)}%
              </span>
              <span className="mt-[3cqw] text-[6.5cqw] font-semibold tracking-[-0.01em] text-go">
                Win Rate
              </span>
            </>
          )}
        </div>

        <AnimatePresence>
          {activeRun && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-inset bg-ink px-2.5 py-1.5 text-center shadow-lg"
            >
              <span className="flex items-center gap-1.5 text-[11.5px] font-semibold whitespace-nowrap text-white">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: activeRun.colour }}
                />
                {activeRun.label}
              </span>
              <span className="mt-0.5 block text-[11px] whitespace-nowrap text-white/70">
                {activeRun.count} {activeRun.count === 1 ? "client" : "clients"} ({activeRun.percent.toFixed(0)}%)
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {totalClients > 0 && (
        <p className="text-[11.5px] leading-[1.4] font-medium text-dim">
          <strong className="text-ink font-semibold">{convertedCount} won</strong> of {totalClients} portfolio clients
        </p>
      )}
    </div>
  );
}
