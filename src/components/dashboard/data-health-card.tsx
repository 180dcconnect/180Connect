import Link from "next/link";

import { Pill } from "@/app/(app)/clients/[id]/section-card";
import { HealthLine } from "@/components/dashboard/system-health-card";
import type { DataHealthFigure, DataHealthSummary } from "@/lib/dashboard/data-health";

/**
 * Admin and leadership only. How much the branch holds, what in it needs a
 * person, and how each import source last went — the questions the ingestion
 * pipeline raises that no other screen answers at a glance.
 *
 * Decided by `src/lib/dashboard/data-health.ts`; this only draws it.
 */

const format = (value: number | null) => (value === null ? "—" : value.toLocaleString());

const LINK =
  "text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead";

function CheckRow({ figure }: { figure: DataHealthFigure }) {
  const label =
    figure.href && figure.value ? (
      <Link href={figure.href} className={LINK}>
        {figure.label}
      </Link>
    ) : (
      figure.label
    );

  return (
    <li className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="min-w-0 font-body text-[13.5px] text-ink">{label}</span>
      <span
        className={`shrink-0 font-body text-[13.5px] font-semibold tabular-nums ${
          figure.tone === "attention" ? "text-hold" : "text-ink"
        }`}
      >
        {format(figure.value)}
      </span>
    </li>
  );
}

export function DataHealthCard({ summary }: { summary: DataHealthSummary }) {
  const count = summary.warnings.length;

  return (
    <section
      aria-labelledby="data-health-heading"
      className="h-full rounded-panel border border-rule bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2
            id="data-health-heading"
            className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
          >
            Data health
          </h2>
          {count > 0 && (
            <Pill tone="hold">{`${count} ${count === 1 ? "thing needs" : "things need"} a look`}</Pill>
          )}
        </div>
        <Link href="/admin/import-status" className={`font-body text-[13px] font-semibold ${LINK}`}>
          Import runs →
        </Link>
      </div>

      {count > 0 && (
        <div className="border-t border-rule-soft bg-hold-wash/50 px-5 py-3">
          <ul className="space-y-1">
            {summary.warnings.map((warning) => (
              <li key={warning} className="font-body text-[13px] leading-[1.55] text-dim">
                {warning}
              </li>
            ))}
          </ul>
          <p className="mt-2 font-body text-[12.5px] leading-[1.55] text-dim">
            Nothing here means anything is lost — a failed import can run again and the
            records are still there. Pass anything you don&apos;t recognise to whoever looks
            after the system.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 divide-x divide-rule-soft border-t border-rule-soft">
        {summary.totals.map((figure) => (
          <div key={figure.key} className="px-5 py-3">
            <dt className="font-body text-[13px] text-dim">{figure.label}</dt>
            <dd className="mt-1 font-body text-[28px] leading-none font-semibold tracking-[-0.02em] tabular-nums text-ink">
              {format(figure.value)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-rule-soft px-5 py-3">
        <h3 className="font-body text-[13px] font-semibold text-dim">Records</h3>
        <ul className="mt-1">
          {summary.checks.map((figure) => (
            <CheckRow key={figure.key} figure={figure} />
          ))}
        </ul>
      </div>

      <div className="border-t border-rule-soft px-5 py-3">
        <h3 className="font-body text-[13px] font-semibold text-dim">Last import</h3>
        {summary.sources === null ? (
          <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
            The import runs could not be loaded. Refresh and try again.
          </p>
        ) : summary.sources.length === 0 ? (
          <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
            No imports have run yet.
          </p>
        ) : (
          <ul className="mt-1">
            {summary.sources.map((source) => (
              <HealthLine key={source.raw} label={source.source} tone={source.tone} note={source.note} />
            ))}
          </ul>
        )}
      </div>

      {summary.incomplete && (
        <p className="border-t border-rule-soft px-5 py-2.5 font-body text-[12.5px] leading-[1.55] text-dim">
          A dash means that figure just didn&apos;t load — the data behind it is fine. Refresh
          and try again.
        </p>
      )}
    </section>
  );
}

export default DataHealthCard;
