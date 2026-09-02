import { Database, TriangleAlert } from "lucide-react";

import { bulkFunnel, formatCount, type RunStats } from "./bulk-funnel";
import { CopyCommand } from "./copy-command";

/**
 * The bulk register import: what it last did, and how to run it again.
 *
 * Deliberately not a button. The extracts are 508MB of charities and 1.26GB of
 * annual returns, which is not work for a serverless function with a 300s
 * ceiling — the same mistake the old "Run import" button on this page made with
 * a much smaller job, and the reason it carried a TODO about timing out. An
 * operator running this from a terminal when the criteria change is the honest
 * shape, so the page shows the command rather than pretending to be one.
 *
 * The funnel is the part that earns the space. It is the only record of *why*
 * the filter selected what it selected, and a filter widened by accident shows
 * up here as a step change between two runs — which is the failure mode
 * `--dry-run` exists to catch before it reaches the database.
 */

export type LastBulkRun = {
  startedAt: string;
  status: string;
  recordsInserted: number;
  runStats: RunStats;
} | null;

const DRY_RUN_COMMAND = "npm run ingest:charity-commission-bulk -- --dry-run";
const RUN_COMMAND = "npm run ingest:charity-commission-bulk";

export function BulkImportCard({ lastRun }: { lastRun: LastBulkRun }) {
  const funnel = lastRun ? bulkFunnel(lastRun.runStats) : null;

  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <Database className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">
            Established charities (bulk register)
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-[1.6] text-foreground/65">
            Reads the regulator&rsquo;s daily extract of every registered charity
            and keeps the ones that match the criteria below. Charities arrive
            with their filed accounts already attached, which is what fills the
            Financials tab.
          </p>
        </div>
      </div>

      {lastRun ? (
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
          Last run{" "}
          <span className="text-foreground/70">
            {new Date(lastRun.startedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          {" · "}
          <span className="tabular-nums text-foreground/70">
            {formatCount(lastRun.recordsInserted)}
          </span>{" "}
          written
        </p>
      ) : (
        <p className="mt-4 text-sm text-foreground/55">
          This import has not run yet.
        </p>
      )}

      {funnel && (
        <div className="mt-4 rounded-xl border border-black/[0.06] bg-black/[0.015] p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
            How the last run narrowed the register
          </h3>
          <ol className="mt-3 space-y-3">
            {funnel.map((stage) => (
              <li key={stage.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <span className="text-sm font-semibold text-foreground/80">
                    {stage.label}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {formatCount(stage.value)}
                    {stage.dropped !== null && stage.dropped > 0 && (
                      <span className="ml-2 text-xs font-semibold text-foreground/40">
                        &minus;{formatCount(stage.dropped)}
                      </span>
                    )}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.06]"
                  role="presentation"
                >
                  <div
                    className="h-full rounded-full bg-brand/70"
                    style={{ width: `${stage.share}%` }}
                  />
                </div>
                <p className="mt-1 text-xs leading-[1.5] text-foreground/45">{stage.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {lastRun && !funnel && (
        <p className="mt-4 rounded-xl border border-black/[0.06] bg-black/[0.015] p-4 text-sm leading-[1.6] text-foreground/55">
          This run recorded no breakdown — it predates the change that stores
          one. The next run will show how the register was narrowed.
        </p>
      )}

      <div className="mt-5 space-y-3">
        <CopyCommand
          command={DRY_RUN_COMMAND}
          label="Check what it would import"
          hint="Streams and filters exactly as a real run does, then prints the counts and writes nothing."
        />
        <CopyCommand
          command={RUN_COMMAND}
          label="Run the import"
          hint="Writes to whichever database the environment points at. It refuses to run against production."
        />
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs leading-[1.6] text-amber-900">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
        <span>
          Always dry-run first. A change that widens the criteria can take the
          import from a few thousand charities to tens of thousands, and the
          count is the only warning you get.
        </span>
      </p>
    </section>
  );
}
