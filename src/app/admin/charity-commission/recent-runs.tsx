"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { StatusBadge } from "../import-status/status-badge";
import {
  PIPELINE_LABEL,
  summariseRun,
  type CharityCommissionRun,
} from "./bulk-funnel";

/**
 * The recent Charity Commission runs — and the landing view of this screen.
 *
 * ── Why this is first ──
 *
 * The page used to open on an explainer, then a card about a file, then seven
 * hundred lines of filter controls, and only then this. But the question
 * someone arrives with is almost always "did the import work", not "let me
 * compose a new one": imports are run occasionally and checked repeatedly. So
 * history is the page, and starting an import is an action on it.
 *
 * ── Why the latest run is bigger than the rest ──
 *
 * One run is the answer to that question and the others are context. Given
 * equal weight, a reader has to parse the timestamps to find out which row is
 * the one they came for. The headline figure is the number they would have gone
 * looking for — how many clients this actually added.
 *
 * The column headings were once the machine's words — Fetched / Written /
 * Skipped / Failed. What a reader wants is what happened, so each run says it in
 * a sentence and the counts support it, the same treatment `run-format.ts` gives
 * the Import Status page. This is a summary, not that page: it shows the last
 * few and links across for the rest.
 */

const COUNT = new Intl.NumberFormat("en-GB");

function when(iso: string, withYear = false): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The one figure worth setting at headline size, or null when the run has no
 * number worth enlarging — a failure, or one still in flight.
 */
function headline(run: CharityCommissionRun): { value: number; label: string } | null {
  if (run.job_status === "running" || run.job_status === "failed") return null;
  if (run.records_inserted > 0)
    return { value: run.records_inserted, label: run.records_inserted === 1 ? "charity added" : "charities added" };
  if (run.records_skipped > 0)
    return { value: run.records_skipped, label: "already on the list" };
  return null;
}

/**
 * What the headline figure leaves out. Deliberately not `summariseRun` — that
 * sentence opens with the same count the headline has just shown at three times
 * the size, and reading a number twice in a row reads as two different numbers.
 */
function detail(run: CharityCommissionRun): string {
  if (run.job_status === "running") return "Running now.";
  if (run.job_status === "failed") return "Failed — nothing was imported.";

  const top = headline(run);
  const parts: string[] = [];
  if (run.records_inserted > 0 && top?.label !== "charities added" && top?.label !== "charity added")
    parts.push(`${COUNT.format(run.records_inserted)} written`);
  if (run.records_skipped > 0 && top?.label !== "already on the list")
    parts.push(`${COUNT.format(run.records_skipped)} already on the list`);
  if (run.records_failed > 0) parts.push(`${COUNT.format(run.records_failed)} unusable`);

  if (parts.length === 0) {
    return top ? "Nothing else changed." : "Nothing new to import.";
  }
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

export function RecentRuns({
  runs,
  action,
  secondaryAction,
}: {
  runs: CharityCommissionRun[];
  /** The primary action for the screen — supplied by the shell that owns the mode. */
  action?: ReactNode;
  /**
   * The quieter way to start something from this screen — the single-charity
   * lookup. Rendered before the primary action so the reader meets the two
   * together, with the solid button last and therefore weightiest.
   */
  secondaryAction?: ReactNode;
}) {
  const [latest, ...older] = runs;

  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
        <h2 className="text-sm font-bold text-foreground">Recent imports</h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {secondaryAction}
          {action}
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="border-t border-black/[0.06] px-5 py-10 text-center sm:px-6">
          <p className="text-sm font-bold text-foreground">Nothing imported yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-[1.6] text-foreground/55">
            Start an import to choose which charities from the register should
            become clients. Nothing is added until you confirm the selection.
          </p>
        </div>
      ) : (
        <>
          {/* The headline run. */}
          <div className="border-t border-black/[0.06] bg-black/[0.012] px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  {PIPELINE_LABEL[latest.api_source] ?? latest.api_source}
                  {" · "}
                  <span className="text-foreground/55">{when(latest.started_at, true)}</span>
                </p>
              </div>
              <StatusBadge status={latest.job_status} />
            </div>

            {(() => {
              const top = headline(latest);
              return top ? (
                <p className="mt-2.5 flex items-baseline gap-2">
                  <span className="text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-none tabular-nums tracking-[-0.03em]">
                    {COUNT.format(top.value)}
                  </span>
                  <span className="text-sm text-foreground/55">{top.label}</span>
                </p>
              ) : (
                <p className="mt-2.5 flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
                  {latest.job_status === "running" && (
                    <Loader2 className="h-4 w-4 animate-spin text-foreground/40" strokeWidth={2.2} />
                  )}
                  {latest.job_status === "running" ? "Import in progress" : "Import failed"}
                </p>
              );
            })()}

            <p className="mt-1.5 text-sm leading-[1.6] text-foreground/60">{detail(latest)}</p>
          </div>

          {older.length > 0 && (
            <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
              {older.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 sm:px-6"
                >
                  <span className="w-32 shrink-0 text-xs tabular-nums text-foreground/45">
                    {when(run.started_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground/70 flex items-center gap-2">
                    <span className="truncate">{summariseRun(run)}</span>
                  </span>
                  <StatusBadge status={run.job_status} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="border-t border-black/[0.06] px-5 py-3 sm:px-6">
        <Link
          href="/admin/import-status?source=charity_commission"
          className="text-xs font-bold text-brand hover:underline"
        >
          Full import history →
        </Link>
      </div>
    </section>
  );
}
