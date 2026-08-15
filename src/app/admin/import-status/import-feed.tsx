"use client";

import { useState, type ComponentType } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { ChevronDown, CircleCheck, CircleDot, CircleX, LoaderCircle, TriangleAlert } from "lucide-react";

import { EASE, entranceIndexed } from "@/components/brand/motion";
import { StatusBadge } from "./status-badge";
import type { RunCount, RunTone, RunView } from "./run-format";

/**
 * Import runs as a feed rather than a table. Eight numeric columns forced the
 * reader to decode a row before knowing whether anything had gone wrong; here
 * each run says what happened, the badge says how it ended, and the full count
 * breakdown is one click away.
 *
 * Everything shown was formatted on the server (`run-format.ts`), so there is no
 * clock in this component to disagree with the server's.
 */

type RowIcon = ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;

/** The status glyph. Same four states the badge names, drawn once each. */
const ICONS: Record<RunTone, RowIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
  info: LoaderCircle,
  neutral: CircleDot,
};

/** Matches the sidebar rail's spring, so every hover in the app feels the same. */
const ICON_SPRING = { type: "spring", stiffness: 420, damping: 17, mass: 0.6 } as const;

/**
 * A gesture per outcome, each under the rail's ~10% / ~8° ceiling. The running
 * spinner is the exception that proves it: it turns a half-revolution because
 * that is literally what the row is reporting.
 */
const ICON_MOTION: Record<RunTone, Variants> = {
  success: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.08, rotate: -6 } },
  warning: { rest: { scale: 1, y: 0 }, hover: { scale: 1.08, y: -2 } },
  danger: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.08, rotate: 8 } },
  info: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.06, rotate: 180 } },
  neutral: { rest: { scale: 1 }, hover: { scale: 1.08 } },
};

/**
 * Tone lands on the icon disc and on a count that matters — never on a row
 * background, which would turn a hundred runs into a heat map.
 *
 * The colours are the badge's own (`status-helpers.ts`): `bg-*-50 text-*-800`.
 * That pill is what people already read this page's status from, so the disc
 * beside it agrees with it rather than proposing a second palette.
 */
const TONE_CLASS: Record<RunTone, string> = {
  success: "bg-green-50 text-green-800",
  warning: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-800",
  info: "bg-blue-50 text-blue-800",
  neutral: "bg-gray-50 text-gray-800",
};

/** A count chip only takes colour when its number is worth noticing. */
const COUNT_CLASS: Record<RunTone, string> = {
  success: "bg-green-50 text-green-800",
  warning: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-800",
  info: "bg-blue-50 text-blue-800",
  neutral: "bg-black/[0.04] text-foreground/70",
};

export type RunDayGroup = { key: string; label: string; events: RunView[] };

export function ImportFeed({ groups }: { groups: RunDayGroup[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // Indexed across the whole feed, not restarted per day, so two short days in a
  // row don't arrive faster than one long one.
  let position = 0;

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <div className="flex items-baseline justify-between gap-4 px-1">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              {group.label}
            </h2>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] tabular-nums text-foreground/25">
              {group.events.length} run{group.events.length === 1 ? "" : "s"}
            </p>
          </div>

          <ul className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
            {group.events.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                index={position++}
                open={expanded === run.id}
                onToggle={() => setExpanded((current) => (current === run.id ? null : run.id))}
                reduceMotion={Boolean(reduceMotion)}
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
  reduceMotion,
}: {
  run: RunView;
  index: number;
  open: boolean;
  onToggle: () => void;
  reduceMotion: boolean;
}) {
  const Icon = ICONS[run.tone];

  return (
    <motion.li
      variants={entranceIndexed()}
      custom={index}
      className="border-b border-black/[0.06] last:border-b-0"
    >
      {/* Hover is claimed by the whole row, not the glyph: a 20px icon is a poor
          target, and the gesture answers "what is this row" as the cursor
          crosses it. */}
      <motion.div initial="rest" animate="rest" whileHover="hover">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:gap-4 sm:px-5"
        >
          <motion.span
            aria-hidden="true"
            variants={reduceMotion ? undefined : ICON_MOTION[run.tone]}
            transition={ICON_SPRING}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${TONE_CLASS[run.tone]}`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden={true} />
          </motion.span>

          <span className="min-w-0 flex-1">
            {/* On a phone the stamp rides this row instead of holding its own
                column, the same arrangement the audit feed uses. */}
            <span className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  {run.source}
                </span>
                <StatusBadge status={run.status} />
              </span>
              <span
                className="shrink-0 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.08em] tabular-nums text-foreground/35 sm:hidden"
                title={run.startedExact}
              >
                {run.startedRelative}
              </span>
            </span>

            <span className="mt-1.5 block text-[15px] font-bold leading-[1.45]">{run.summary}</span>

            {run.highlights.length > 0 && (
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                {run.highlights.map((count) => (
                  <CountChip key={count.label} count={count} />
                ))}
              </span>
            )}

            {/* F039 AC3 — a failure has to be legible without opening anything,
                so the reason sits on the collapsed row. Once the row is open the
                panel prints it in full, and two copies of the same sentence a
                few pixels apart reads as a rendering fault. */}
            {run.errorMessage && !open && (
              <span className="mt-2 block max-w-prose text-sm leading-[1.7] text-red-800">
                {run.errorMessage}
              </span>
            )}
          </span>

          <span className="flex shrink-0 items-center gap-3 pt-0.5">
            <span
              className="hidden text-right text-[11px] font-bold uppercase tracking-[0.08em] tabular-nums text-foreground/35 sm:block"
              title={run.startedExact}
            >
              {run.startedRelative}
            </span>
            <motion.span
              aria-hidden="true"
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="text-foreground/25"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            </motion.span>
          </span>
        </button>

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
              <div className="border-t border-black/[0.05] bg-black/[0.015] px-4 py-4 sm:px-5 sm:pl-[4.25rem]">
                <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Source" value={run.source} />
                  <Field label="Started" value={run.startedExact} />
                  <Field label="Finished" value={run.finishedExact ?? "Still running"} />
                  <Field label="Took" value={run.duration} />
                </dl>

                {/* Every count, zeroes included. "0 failed" is the reassurance
                    the collapsed row deliberately leaves out — it belongs where
                    someone has asked for the full picture. */}
                <div className="mt-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                    Records
                  </p>
                  <dl className="mt-2 grid overflow-hidden rounded-xl bg-white ring-1 ring-black/[0.06] sm:grid-cols-5">
                    {run.counts.map((count) => (
                      <div
                        key={count.label}
                        className="flex items-baseline justify-between gap-3 border-b border-black/[0.05] px-4 py-2.5 last:border-b-0 sm:flex-col sm:items-start sm:gap-1 sm:border-b-0 sm:border-r sm:last:border-r-0"
                      >
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                          {count.label}
                        </dt>
                        <dd
                          className={`text-[17px] font-black tabular-nums ${
                            count.value > 0 && count.tone !== "neutral"
                              ? COUNT_TEXT[count.tone]
                              : "text-foreground/80"
                          }`}
                        >
                          {count.value.toLocaleString()}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {run.errorMessage && (
                  <div className="mt-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                      Why it failed
                    </p>
                    {/* AC3 of F039: a failure has to be understandable here,
                        without going to the server logs. Monospace because the
                        message is usually the source's own error string. */}
                    <p className="mt-2 overflow-x-auto rounded-xl bg-red-50 px-4 py-3 font-mono text-xs leading-[1.6] text-red-800">
                      {run.errorMessage}
                    </p>
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

/** Text-only tones, for a number that is already sitting on white. */
const COUNT_TEXT: Record<RunTone, string> = {
  success: "text-green-800",
  warning: "text-amber-800",
  danger: "text-red-800",
  info: "text-blue-800",
  neutral: "text-foreground/80",
};

function CountChip({ count }: { count: RunCount }) {
  // A count only earns its colour by being non-zero and by meaning something
  // went wrong; "260 skipped" is routine and stays neutral.
  const tone: RunTone = count.value > 0 ? count.tone : "neutral";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.02em] ${COUNT_CLASS[tone]}`}
    >
      <span className="tabular-nums">{count.value.toLocaleString()}</span>
      <span className="font-bold uppercase tracking-[0.08em] opacity-60">{count.label}</span>
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
        {label}
      </dt>
      <dd className="mt-1.5 truncate text-[13px] text-foreground/75" title={value}>
        {value}
      </dd>
    </div>
  );
}
