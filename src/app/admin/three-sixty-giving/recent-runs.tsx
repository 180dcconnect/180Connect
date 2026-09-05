import Link from "next/link";
import { Loader2 } from "lucide-react";

import { StatusBadge } from "../import-status/status-badge";
import { summariseRun, type IngestionRunRow } from "../import-status/run-format";

/**
 * The recent 360Giving runs — the landing view's second half, after coverage.
 *
 * Same treatment as the Charity Commission history: the latest run is the
 * answer to "did it work" and gets headline weight, older runs are one
 * sentence each, and the counts support the sentences rather than replacing
 * them (`summariseRun` states each run's outcome in words). The full history
 * lives on Import Status; this shows the last few and links across.
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
function headline(run: IngestionRunRow): { value: number; label: string } | null {
  if (run.job_status === "running" || run.job_status === "failed") return null;
  if (run.records_inserted > 0)
    return {
      value: run.records_inserted,
      label: run.records_inserted === 1 ? "new grant record" : "new grant records",
    };
  if (run.records_skipped > 0) return { value: run.records_skipped, label: "already held" };
  return null;
}

export function ThreeSixtyRecentRuns({ runs }: { runs: IngestionRunRow[] }) {
  const [latest, ...older] = runs;

  return (
    <section className="overflow-hidden rounded-panel border border-rule bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
        <h2 className="font-body text-[19px] font-normal leading-[1.3] tracking-[-0.01em] text-ink">
          Recent imports
        </h2>
      </div>

      {runs.length === 0 ? (
        <div className="border-t border-rule-soft px-5 py-10 text-center sm:px-6">
          <p className="font-body text-[19px] font-normal leading-[1.3] text-ink">
            Nothing imported yet
          </p>
          <p className="mx-auto mt-1.5 max-w-[54ch] text-[13px] leading-[1.55] text-dim">
            Use “Check the next…” above to look up the first few clients.
          </p>
        </div>
      ) : (
        <>
          {/* The headline run. */}
          <div className="border-t border-rule-soft bg-paper px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-xs tabular-nums text-faint">{when(latest.started_at, true)}</p>
              <StatusBadge status={latest.job_status} />
            </div>

            {(() => {
              const top = headline(latest);
              return top ? (
                <p className="mt-2.5 flex items-baseline gap-2">
                  <span className="text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-none tabular-nums tracking-[-0.03em] text-ink">
                    {COUNT.format(top.value)}
                  </span>
                  <span className="text-sm text-dim">{top.label}</span>
                </p>
              ) : (
                <p className="mt-2.5 flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-ink">
                  {latest.job_status === "running" && (
                    <Loader2 className="h-4 w-4 animate-spin text-faint" strokeWidth={2.2} />
                  )}
                  {latest.job_status === "running" ? "Import in progress" : "Import failed"}
                </p>
              );
            })()}

            <p className="mt-1.5 text-sm leading-[1.65] text-dim">{summariseRun(latest)}</p>
          </div>

          {older.length > 0 && (
            <ul className="divide-y divide-rule-soft border-t border-rule-soft">
              {older.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 sm:px-6"
                >
                  <span className="w-32 shrink-0 text-xs tabular-nums text-faint">
                    {when(run.started_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-dim">
                    {summariseRun(run)}
                  </span>
                  <StatusBadge status={run.job_status} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="border-t border-rule-soft px-5 py-3 sm:px-6">
        <Link
          href="/admin/import-status?source=360giving"
          className="text-xs font-bold text-lead hover:underline"
        >
          Full import history →
        </Link>
      </div>
    </section>
  );
}
