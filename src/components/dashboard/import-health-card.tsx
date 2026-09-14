import Link from "next/link";

import { Pill } from "@/app/clients/[id]/section-card";

/**
 * F039 — is the register still moving?
 *
 * The admin dashboard has never said. It is the one screen whose job is
 * "is the machine running", and the answer lived two clicks away on
 * `/admin/import-status` behind a filter rail — so an import that stopped on
 * Friday looked exactly like one that ran this morning.
 *
 * The summary is computed by `app/admin/dashboard/import-health.ts`; this
 * component only draws it. Its props are structurally typed on purpose: the
 * app-dir module that produces them is the thing being rendered, and a card in
 * `components/` importing a page's types would tie the two together for no
 * gain. Anything matching the shape works.
 */

type ImportTone = "success" | "warning" | "danger" | "info" | "neutral";

export type ImportHealthCardRow = {
  raw: string;
  source: string;
  statusLabel: string;
  tone: ImportTone;
  /** "2 hours ago". */
  relative: string;
  /** One line from run-format: what the run did. */
  summary: string;
};

export type ImportHealthCardProps = {
  /** Null when the runs could not be read at all. */
  summary: {
    verdict: "healthy" | "problems" | "quiet";
    sources: ImportHealthCardRow[];
    /** Sources in the window before the card's cap. */
    sourceCount: number;
    problemRuns: number;
    /** The newest run overall. */
    latest: { source: string; relative: string } | null;
  } | null;
};

const TONE_CHROME: Record<ImportTone, { dot: string; text: string }> = {
  success: { dot: "bg-go", text: "text-go" },
  warning: { dot: "bg-hold", text: "text-hold" },
  danger: { dot: "bg-stop", text: "text-stop" },
  info: { dot: "bg-lead", text: "text-lead" },
  neutral: { dot: "bg-faint", text: "text-dim" },
};

const VERDICT_PILL = {
  healthy: { tone: "go", word: "Clean" },
  problems: { tone: "stop", word: "Problems" },
  quiet: { tone: "hold", word: "Quiet" },
} as const;

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function verdictSentence(summary: NonNullable<ImportHealthCardProps["summary"]>): string {
  if (summary.verdict === "problems") {
    return `${plural(summary.problemRuns, "run")} failed or finished incomplete in the last 24 hours.`;
  }
  if (summary.verdict === "quiet") {
    return "No import has run in the last 24 hours.";
  }
  return summary.latest
    ? `Everything finished cleanly — last run ${summary.latest.relative}.`
    : "Everything finished cleanly in the last 24 hours.";
}

export function ImportHealthCard({ summary }: ImportHealthCardProps) {
  const hidden = summary ? Math.max(summary.sourceCount - summary.sources.length, 0) : 0;

  return (
    <section
      aria-labelledby="import-health-heading"
      className="rounded-panel border border-rule bg-white"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
        <h2
          id="import-health-heading"
          className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
        >
          Import health
        </h2>
        <Link
          href="/admin/import-status"
          className="font-body text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
        >
          View runs →
        </Link>
      </div>

      {!summary ? (
        <p className="border-t border-rule-soft px-5 py-4 font-body text-[13px] leading-[1.55] text-dim">
          The import runs could not be loaded. Refresh and try again.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2.5 border-t border-rule-soft px-5 py-3">
            <Pill tone={VERDICT_PILL[summary.verdict].tone}>
              {VERDICT_PILL[summary.verdict].word}
            </Pill>
            <p className="min-w-0 font-body text-[13px] leading-[1.55] text-dim">
              {verdictSentence(summary)}
            </p>
          </div>

          <ul className="divide-y divide-rule-soft border-t border-rule-soft">
            {summary.sources.map((row) => (
              <li key={row.raw} className="flex items-start gap-2.5 px-5 py-2.5">
                <span
                  aria-hidden="true"
                  className={`mt-[7px] size-1.5 shrink-0 rounded-full ${TONE_CHROME[row.tone].dot}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-body text-[13.5px] font-medium text-ink">
                      {row.source}
                    </span>
                    <span className="font-body text-[12.5px] text-dim">{row.relative}</span>
                  </p>
                  <p className="mt-0.5 font-body text-[12.5px] leading-[1.45] text-dim">
                    {row.summary}
                  </p>
                </div>
                <span
                  className={`shrink-0 self-center font-body text-[12.5px] font-semibold ${TONE_CHROME[row.tone].text}`}
                >
                  {row.statusLabel}
                </span>
              </li>
            ))}
          </ul>

          {hidden > 0 && (
            <p className="border-t border-rule-soft px-5 py-2.5 font-body text-[12.5px] text-faint">
              {plural(hidden, "other source")} also ran in this window.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default ImportHealthCard;
