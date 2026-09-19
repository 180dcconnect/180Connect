"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotionConfig } from "motion/react";

import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import {
  formatProgressDuration,
  importProgressReadingAt,
  type ImportProgressPlan,
} from "@/lib/ingestion/import-progress";
import { StatusBadge } from "./status-badge";

const STICKS = Array.from({ length: 28 }, (_, index) => index);
const REFRESH_INTERVAL_MS = 5_000;

export type RunningImport = {
  id: string;
  source: string;
  startedLabel: string;
  startedAt: string;
  observedAt: string;
  progress: ImportProgressPlan | null;
  triggerLabel?: string | null;
};

/** The quiet route from a summary row to the records for one import. */
export function ImportRunDetailsLink({ id }: { id: string }) {
  return (
    <Link
      href={`/admin/import-status/${id}`}
      className="text-xs font-semibold text-lead underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
    >
      View records
    </Link>
  );
}

/**
 * Re-reads the server-owned run state only while there is work to watch. The
 * database remains the source of truth; this poller never decides that a run
 * finished or keeps a second copy of its status in browser state.
 */
export function ImportRunRefreshPoller({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refreshIfVisible, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [active, router]);

  return null;
}

/** A measured/estimated gauge when possible, with an honest activity fallback. */
export function RunningImportGauge({
  percent,
  ariaValueText,
}: {
  percent: number | null;
  ariaValueText: string;
}) {
  const reduceMotion = useReducedMotionConfig();

  if (percent !== null) {
    return (
      <HorizontalStickGauge
        checked={percent}
        total={100}
        ariaLabel="Import progress"
        ariaValueText={ariaValueText}
        showTooltip={false}
        stickHeight={12}
        className="mt-3"
      />
    );
  }

  return (
    <div
      role="progressbar"
      aria-label="Import in progress"
      aria-valuetext={ariaValueText}
      className="mt-3 flex h-4 items-center gap-1 overflow-hidden"
    >
      {STICKS.map((stick) => (
        <motion.span
          key={stick}
          aria-hidden="true"
          animate={reduceMotion ? { opacity: 0.75 } : { opacity: [0.2, 1, 0.2] }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 1.5, delay: stick * 0.045, ease: "easeInOut", repeat: Infinity }
          }
          className="h-3 w-[3px] shrink-0 rounded-full bg-lead"
        />
      ))}
    </div>
  );
}

export function RunningImportRow({
  run,
  canInspect,
}: {
  run: RunningImport;
  canInspect: boolean;
}) {
  // Start from the server's clock so hydration prints the same reading, then
  // advance locally. This is display-only: the five-second route refresh still
  // owns the authoritative transition from running to finished.
  const [nowMs, setNowMs] = useState(() => Date.parse(run.observedAt));

  useEffect(() => {
    const update = () => setNowMs(Date.now());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const reading = run.progress
    ? importProgressReadingAt(run.progress, run.startedAt, nowMs)
    : null;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((nowMs - Date.parse(run.startedAt)) / 1_000),
  );
  const fallbackText = `${formatProgressDuration(elapsedSeconds)} so far · this import does not report a progress count.`;

  return (
    <div className="bg-paper px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <p className="text-[13.5px] font-semibold text-ink">{run.source}</p>
            {run.triggerLabel && (
              <span className="rounded-inset bg-paper-sunk px-2 py-0.5 text-[11px] font-medium text-dim">
                {run.triggerLabel}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-semibold text-ink">Import in progress</p>
          <p className="mt-1 text-xs text-dim">Started {run.startedLabel}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <StatusBadge status="running" />
          {canInspect && <ImportRunDetailsLink id={run.id} />}
        </div>
      </div>
      <RunningImportGauge
        percent={reading?.percent ?? null}
        ariaValueText={reading?.ariaValueText ?? fallbackText}
      />
      <p className="mt-2 text-xs text-dim">
        {reading?.statusText ?? fallbackText}
      </p>
    </div>
  );
}
