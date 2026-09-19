"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotionConfig } from "motion/react";

import { StatusBadge } from "./status-badge";

const STICKS = Array.from({ length: 28 }, (_, index) => index);
const REFRESH_INTERVAL_MS = 5_000;

export type RunningImport = {
  id: string;
  source: string;
  startedLabel: string;
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
 * database remains the source of truth; this component never estimates a
 * percentage or keeps a second copy of a run in browser state.
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

/** An activity gauge, not a percentage: register imports do not report a total. */
export function RunningImportGauge() {
  const reduceMotion = useReducedMotionConfig();

  return (
    <div
      role="progressbar"
      aria-label="Import in progress"
      aria-valuetext="Import is still working. Progress is not available yet."
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
      <RunningImportGauge />
      <p className="mt-2 text-xs text-dim">This import is still working. Progress will appear here when it is available.</p>
    </div>
  );
}
