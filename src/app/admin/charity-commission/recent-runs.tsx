import Link from "next/link";

import { StatusBadge } from "../import-status/status-badge";
import {
  PIPELINE_LABEL,
  summariseRun,
  type CharityCommissionRun,
} from "./bulk-funnel";

/**
 * The recent Charity Commission runs — both pipelines.
 *
 * The old table filtered on `api_source = 'charity_commission'`, so bulk runs
 * were invisible on the Charity Commission page: the import that actually
 * delivered the financial history could not be seen from the page about it.
 * Both sources are shown, with the pipeline named on each row.
 *
 * The column headings were the machine's words — Fetched / Written / Skipped /
 * Failed. What a reader wants is what happened, so each run says it in a
 * sentence and the counts support it, the same treatment `run-format.ts` gives
 * the Import Status page. This is a summary, not that page: it shows the last
 * few and links across for the rest.
 */

export function RecentRuns({ runs }: { runs: CharityCommissionRun[] }) {
  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-xs sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-bold text-foreground">Recent runs</h2>
        <Link
          href="/admin/import-status?source=charity_commission"
          className="text-xs font-bold text-brand hover:underline"
        >
          Full import history
        </Link>
      </div>

      {runs.length === 0 ? (
        <p className="mt-3 text-sm text-foreground/55">
          No Charity Commission imports have run yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-black/[0.06]">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-sm font-bold text-foreground">
                    {PIPELINE_LABEL[run.api_source] ?? run.api_source}
                  </span>
                  <span className="text-xs text-foreground/45">
                    {new Date(run.started_at).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-[1.6] text-foreground/65">
                  {summariseRun(run)}
                </p>
              </div>
              {/* The same pill the Import Status page uses, not a second
                  vocabulary for the same four states. */}
              <StatusBadge status={run.job_status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
