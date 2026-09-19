"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronDown, CircleX, TriangleAlert } from "lucide-react";

import { EASE, entranceIndexed } from "@/components/brand/motion";
import { StatusBadge } from "./status-badge";
import { ImportRunRefreshPoller, RunningImportRow } from "./running-import-row";
import type { RunCount, RunTone, RunView } from "./run-format";

/**
 * Import runs as a feed rather than a table. Eight numeric columns forced the
 * reader to decode a row before knowing whether anything had gone wrong; here
 * each run puts the relevant outcome counts first, the badge says how it
 * ended, and the full count breakdown is one click away.
 *
 * Everything shown was formatted on the server (`run-format.ts`), so there is no
 * clock in this component to disagree with the server's.
 */

const COUNT_EXPLANATIONS: Record<string, string> = {
  "Added to the client list":
    "Clients added by this import. Adding works through everything waiting, so on a run that clears a backlog this can be larger than the number of records this run read — the sentence above says when that happened.",
  "Already on the list": "Records whose details matched what we already hold, so nothing changed.",
  "Needs a look":
    "Everything that stopped short of the client list and has somewhere to be answered: possible duplicates, records held for review, and records that could not be saved.",
  "From the source":
    "How many records this run read from the source before any of them were added.",
  "Held for review":
    "The client criteria could not decide these on their own. An admin answers them on the review queue.",
  "Possible duplicates":
    "These look like a client already on the list. An admin decides on the possible duplicates screen.",
  "Did not fit the criteria":
    "Outside the branch's client criteria — the wrong kind of organisation, or outside the region.",
  "Could not be saved":
    "The client list refused these. The reason is in the panel below, with what to do about it.",
};

/**
 * The run's own page, filtered to the records a count is made of. Only offered
 * when the reader can open that page at all — a link that lands on a redirect
 * is worse than no link.
 */
function countHref(runId: string, count: RunCount, canInspect: boolean): string | undefined {
  if (!canInspect || !count.statusKeys || count.statusKeys.length === 0 || count.value === 0) {
    return undefined;
  }
  const params = new URLSearchParams();
  for (const key of count.statusKeys) params.append("status", key);
  return `/admin/import-status/${runId}?${params.toString()}`;
}

export type RunDayGroup = { key: string; label: string; events: RunView[] };

function formatOrdinalDate(label: string): string {
  return label.replace(/^(\d+)/, (match) => {
    const n = parseInt(match, 10);
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    const suffix = s[(v - 20) % 10] || s[v] || s[0];
    return `${n}${suffix}`;
  });
}

export function ImportFeed({
  groups,
  canInspect,
}: {
  groups: RunDayGroup[];
  /** Whether the run detail page (raw source records, admin-only) is reachable. */
  canInspect: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const hasActiveRun = groups.some((group) => group.events.some((run) => run.status === "running"));
  // Indexed across the whole feed, not restarted per day, so two short days in a
  // row don't arrive faster than one long one.
  let position = 0;

  return (
    <div className="space-y-8">
      <ImportRunRefreshPoller active={hasActiveRun} />
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <div className="flex items-baseline justify-between gap-4 px-1 pb-1">
            <h2 className="font-body text-lg font-semibold tracking-[-0.01em] text-ink sm:text-xl">
              {formatOrdinalDate(group.label)}
            </h2>
            <p className="font-body text-xs font-semibold tabular-nums text-faint">
              {group.events.length} run{group.events.length === 1 ? "" : "s"}
            </p>
          </div>

          <ul className="overflow-hidden rounded-panel border border-rule bg-white">
            {group.events.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                index={position++}
                open={expanded === run.id}
                onToggle={() => setExpanded((current) => (current === run.id ? null : run.id))}
                canInspect={canInspect}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RunRow({
  run,
  index,
  open,
  onToggle,
  canInspect,
}: {
  run: RunView;
  index: number;
  open: boolean;
  onToggle: () => void;
  canInspect: boolean;
}) {
  if (run.status === "running") {
    return (
      <motion.li
        variants={entranceIndexed()}
        custom={index}
        className="border-b border-rule-soft last:border-b-0"
      >
        <RunningImportRow
          run={{
            id: run.id,
            source: run.source,
            startedLabel: run.startedRelative,
            startedAt: run.startedIso,
            observedAt: run.observedAt,
            progress: run.progress,
            triggerLabel: run.triggerLabel,
          }}
          canInspect={canInspect}
        />
      </motion.li>
    );
  }

  return (
    <motion.li
      variants={entranceIndexed()}
      custom={index}
      className="border-b border-rule-soft last:border-b-0"
    >
      <motion.div>
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
          aria-expanded={open}
          className="flex w-full flex-col gap-4 cursor-pointer px-4 py-5 text-left transition-colors hover:bg-paper/55 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead sm:flex-row sm:gap-6 sm:px-5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="text-[13.5px] font-semibold text-ink">{run.source}</span>
              {run.triggerLabel && (
                <span className="rounded-inset bg-paper-sunk px-2 py-0.5 text-[11px] font-medium text-dim">
                  {run.triggerLabel}
                </span>
              )}
            </div>

            {/* The sentence always shows, even when there are numbers beside
                it: it is the only place a run says something the counts cannot
                — that a backlog was cleared, that the run did not finish, why
                records were refused. Hiding it behind a non-zero count is how
                "821 added from 98 records" ended up on screen unexplained. */}
            <p className="mt-3 text-sm leading-[1.6] text-dim">{run.summary}</p>

            {run.highlights.length > 0 && (
              <dl className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-3">
                {run.highlights.map((count) => (
                  <CountMetric
                    key={count.label}
                    count={count}
                    href={countHref(run.id, count, canInspect)}
                  />
                ))}
              </dl>
            )}

            {/* F039 AC3 — a failure has to be legible without opening anything,
                so the reason sits on the collapsed row in friendly terms. */}
            {/* Not `errorMessage`: a register import that staged rows and then
                had every one refused stores no run-level error, and that is
                exactly the run whose reason has to be on the collapsed row. */}
            {run.humanError && !open && (
              <div className="mt-3 flex items-center gap-1.5 text-sm leading-[1.7] font-medium text-stop">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden={true} />
                <span>{run.humanError?.summary ?? run.errorMessage}</span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end sm:self-stretch">
            <div className="flex items-center gap-2">
              <StatusBadge status={run.status} />
            {canInspect && (
              <Link
                href={`/admin/import-status/${run.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 rounded-inset bg-lead px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
              >
                <span>View records</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            <motion.span
              aria-hidden="true"
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="text-faint"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            </motion.span>
            </div>
            <span
              className="mt-1 font-body text-xs font-semibold tabular-nums text-faint sm:mt-auto"
              title={run.startedExact}
            >
              {run.startedRelative}
            </span>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="border-t border-rule-soft bg-paper px-4 py-5 sm:px-5">
                <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
                  <Field label="Source" value={run.source} />
                  <Field
                    label="Trigger"
                    value={
                      run.triggerLabel === "Manual"
                        ? "Manual import"
                        : run.triggerLabel === "Scheduled"
                          ? "Scheduled run"
                          : "Standard"
                    }
                  />
                  <Field label="Started" value={run.startedExact} />
                  <Field label="Finished" value={run.finishedExact ?? "Still running"} />
                  <Field label="Took" value={run.duration} />
                </dl>

                {run.humanError && (
                  <div className="mt-5">
                    <p className="text-xs font-semibold text-stop">
                      {run.errorMessage ? "Why it stopped" : "Why records were not saved"}
                    </p>
                    <div className="mt-2 overflow-hidden rounded-inset border border-stop/25 bg-stop-wash p-4">
                      <div className="flex items-start gap-3">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-inset bg-white/70 text-stop">
                          <CircleX className="h-4 w-4" strokeWidth={2.2} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-semibold text-stop">
                            {run.humanError?.summary ?? "Ingestion run failed"}
                          </h4>
                          <p className="mt-1 text-xs leading-[1.6] text-ink">
                            {run.humanError?.description ?? run.errorMessage}
                          </p>
                          {run.humanError?.actionHint && (
                            <div className="mt-3 flex items-start gap-1.5 rounded-inset bg-white/85 px-3 py-2 text-xs text-ink ring-1 ring-stop/20">
                              <span className="font-semibold shrink-0">How to fix:</span>
                              <span>{run.humanError.actionHint}</span>
                            </div>
                          )}
                          {run.humanError?.rawMessage &&
                            run.humanError.rawMessage.trim() !== "" &&
                            run.humanError.rawMessage !== run.humanError.summary && (
                              <details className="mt-3 text-[11px] text-dim">
                                <summary className="cursor-pointer font-medium hover:underline">
                                  Technical diagnostic details
                                </summary>
                                <pre className="mt-1.5 overflow-x-auto rounded-inset bg-white/65 p-2 font-mono text-[11px] text-ink">
                                  {run.humanError.rawMessage}
                                </pre>
                              </details>
                            )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.li>
  );
}

/** Text-only state tones, for a number that is already sitting on white. */
const COUNT_TEXT: Record<RunTone, string> = {
  success: "text-go",
  warning: "text-hold",
  danger: "text-stop",
  info: "text-lead",
  neutral: "text-ink",
};

/**
 * One headline count. When the count has records behind it and someone who may
 * open them, it is a link into the run filtered to exactly those — the same
 * affordance the run's own page gives its cards, so "Needs a look: 6" is never
 * a number the reader has to go hunting for.
 */
function CountMetric({ count, href }: { count: RunCount; href?: string }) {
  const tone: RunTone = count.value > 0 ? count.tone : "neutral";
  const body = (
    <>
      <dd className={`text-[28px] font-semibold leading-none tabular-nums tracking-[-0.03em] ${COUNT_TEXT[tone]}`}>
        {count.value.toLocaleString()}
      </dd>
      <dt className="mt-1 text-xs font-medium text-dim">{count.label}</dt>
    </>
  );

  if (!href) {
    return (
      <div title={COUNT_EXPLANATIONS[count.label] ?? count.label} className="min-w-[4.5rem]">
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      onClick={(event) => event.stopPropagation()}
      title={COUNT_EXPLANATIONS[count.label] ?? count.label}
      className="min-w-[4.5rem] rounded-inset transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
      aria-label={`Show the ${count.value.toLocaleString()} ${count.label.toLowerCase()} records from this run`}
    >
      {body}
      <span className="mt-1 block text-[11px] font-semibold text-lead underline decoration-lead/30 underline-offset-2">
        Show these
      </span>
    </Link>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-dim">{label}</dt>
      <dd className="mt-1.5 truncate text-[13px] text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
