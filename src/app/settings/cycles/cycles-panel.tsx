"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronRight, Loader2, Plus } from "lucide-react";
import { motion, useReducedMotionConfig } from "motion/react";

import { Pill } from "@/app/(app)/clients/[id]/section-card";
import { EASE } from "@/components/brand/motion";
import { Rise } from "@/components/dashboard-stage";
import { DateRangeCalendar } from "@/components/ui/date-range-calendar";
import { isCompleteRange, rangeLengthDays, type RangeSelection } from "@/lib/date-range";
import { formatShortDate } from "@/lib/display-format";
import {
  findCycleByName,
  findCycleOverlap,
  MAX_CYCLE_NAME_CHARS,
  type CyclePhase,
  type OutreachCycle,
} from "@/lib/outreach-cycles";
import {
  CARD,
  CARD_HINT,
  CARD_TITLE,
  FIELD_LABEL,
  FOOTNOTE,
  INPUT,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
  ROW,
  ROW_ACTION,
} from "../styles";
import { createCycle, deleteCycle, updateCycle } from "./actions";

export type CycleSummary = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  /** "12 Jan 2026 – 3 Apr 2026", formatted server-side. */
  windowLabel: string;
  /** Where today falls relative to this cycle, decided server-side. */
  phase: CyclePhase;
};

type Notice = { tone: "success" | "error"; text: string } | null;
type CycleValues = { name: string; startsOn: string; endsOn: string };

/** A cycle as the pure helpers want it, so the form can check its own answers. */
function asCycle(cycle: CycleSummary): OutreachCycle {
  return {
    id: cycle.id,
    name: cycle.name,
    starts_on: cycle.startsOn,
    ends_on: cycle.endsOn,
  };
}

/** "12 Jan 2026 – 3 Apr 2026 · 83 days". Deterministic, so SSR and client agree. */
function describeSpan(from: string, to: string): string {
  const days = rangeLengthDays(from, to);
  return `${formatShortDate(from)} – ${formatShortDate(to)} · ${days} day${days === 1 ? "" : "s"}`;
}

function windowOf(cycle: OutreachCycle): string {
  return `${formatShortDate(cycle.starts_on)} – ${formatShortDate(cycle.ends_on)}`;
}

const PHASE_PILL: Record<CyclePhase, { tone: "go" | "hold" | "neutral"; label: string }> = {
  running: { tone: "go", label: "In progress" },
  upcoming: { tone: "hold", label: "Not started yet" },
  finished: { tone: "neutral", label: "Finished" },
};

/**
 * The three questions, in the order someone can actually answer them.
 *
 * A cycle is two facts — what it is called and which days it covers — and the
 * old form asked both at once in one grey box with two unlabelled date fields.
 * An admin who has never defined one had no way to tell which day went where,
 * or what any of it did. So: one question per step, in plain words, with the
 * answer to the previous step carried forward.
 */
const STEPS = [
  {
    label: "Name",
    question: "What should this cycle be called?",
  },
  {
    label: "Dates",
    question: "When does it start and end?",
  },
  {
    label: "Check",
    question: "Does this look right?",
  },
] as const;

type Step = 1 | 2 | 3;

/**
 * The define/edit flow. Everything it can tell the reader, it tells them before
 * they save rather than after: a duplicate name and a date range that overlaps
 * an existing cycle are both refused by the database, so both are worked out
 * here and stated where the answer is being given. The clash check reuses
 * `findCycleOverlap` — the same rule the server action enforces — so the two
 * cannot drift into disagreeing about what "overlapping" means.
 */
function CycleWizard({
  mode,
  initialValues,
  cycles,
  ignoreId,
  pending,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  initialValues: CycleValues;
  cycles: OutreachCycle[];
  /** The cycle being edited, so it is not counted as clashing with itself. */
  ignoreId?: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: CycleValues) => void;
}) {
  const reduceMotion = useReducedMotionConfig();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState(initialValues.name);
  const [selection, setSelection] = useState<RangeSelection>({
    from: initialValues.startsOn || null,
    to: initialValues.endsOn || null,
  });
  const nameId = useId();

  const trimmedName = name.trim();
  const range = isCompleteRange(selection) ? selection : null;
  const duplicateName = findCycleByName(cycles, trimmedName, ignoreId);
  const clash = range
    ? findCycleOverlap(cycles, { starts_on: range.from, ends_on: range.to }, ignoreId)
    : null;
  const otherCycles = cycles.filter((cycle) => cycle.id !== ignoreId);

  const nameReady = trimmedName.length > 0 && !duplicateName;
  const datesReady = Boolean(range) && !clash;

  return (
    <div className="mt-4">
      <ol className="flex flex-wrap items-center gap-y-1 text-[13px]">
        {STEPS.map((entry, index) => {
          const value = (index + 1) as Step;
          const current = value === step;
          const answered = value < step;
          return (
            <li key={entry.label} className="flex items-center">
              {index > 0 && (
                <ChevronRight
                  aria-hidden="true"
                  className="mx-0.5 size-3 shrink-0 text-faint"
                  strokeWidth={2.4}
                />
              )}
              <button
                type="button"
                onClick={() => setStep(value)}
                disabled={!answered}
                aria-current={current ? "step" : undefined}
                className={`flex items-center gap-1.5 rounded-inset px-2 py-1 transition-colors ${
                  current
                    ? "bg-lead-wash font-medium text-lead"
                    : answered
                      ? "cursor-pointer text-dim hover:bg-paper hover:text-ink"
                      : "text-faint"
                }`}
              >
                <span aria-hidden="true" className="font-mono text-[11px] tabular-nums">
                  {value}
                </span>
                {entry.label}
              </button>
            </li>
          );
        })}
      </ol>

      <motion.div
        key={step}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: EASE }}
        className="mt-5"
      >
        <h3 className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
          {STEPS[step - 1].question}
        </h3>

        {step === 1 && (
          <div>
            <p className={`mt-1.5 ${CARD_HINT}`}>
              Your team picks this name on the analytics screen, so use one they
              will recognise. It is only a label — on its own it changes nothing.
            </p>
            <label htmlFor={nameId} className={`mt-4 block ${FIELD_LABEL}`}>
              Name
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Spring 26"
              maxLength={MAX_CYCLE_NAME_CHARS}
              autoFocus
              className={`mt-2 ${INPUT}`}
            />
            {duplicateName && (
              <p role="status" className="mt-2 text-[13px] leading-[1.55] text-stop">
                “{duplicateName.name}” already has this name. Pick a different one —
                names have to be different even if the dates do not overlap.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={FIELD_LABEL}>For example</span>
              {["Spring 26", "Autumn 26", "Full year 2026"].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setName(example)}
                  aria-pressed={trimmedName === example}
                  className="cursor-pointer rounded-full bg-paper px-2.5 py-1 text-[12px] font-medium text-dim transition-colors hover:bg-paper-sunk hover:text-ink aria-pressed:bg-lead-wash aria-pressed:text-lead"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <p className={`mt-1.5 ${CARD_HINT}`}>
              Click the first day, then the last day. Emails sent between those
              two days are the ones this cycle counts.
            </p>
            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-8">
              <DateRangeCalendar value={selection} onChange={setSelection} />

              <div className="space-y-3">
                {range ? (
                  clash ? (
                    <div className="rounded-inset bg-hold-wash px-4 py-3">
                      <p className="text-sm font-medium text-hold">
                        These dates overlap “{clash.name}”
                      </p>
                      <p className="mt-1 text-[13px] leading-[1.55] text-ink">
                        “{clash.name}” covers {windowOf(clash)}. Cycles cannot
                        overlap — every email has to belong to exactly one — so
                        pick days outside it.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-inset bg-go-wash px-4 py-3">
                      <p className="text-sm font-medium text-go">These dates are free</p>
                      <p className="mt-1 text-[13px] leading-[1.55] text-ink">
                        {trimmedName || "This cycle"} would run{" "}
                        {describeSpan(range.from, range.to)}.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="rounded-inset bg-paper px-4 py-3">
                    <p className="text-[13px] leading-[1.55] text-dim">
                      Pick both ends and the span appears here.
                    </p>
                  </div>
                )}

                <div className="rounded-inset border border-rule px-4 py-3">
                  <h4 className="text-[13px] font-medium text-ink">
                    {otherCycles.length === 0 ? "No other cycles yet" : "Days already taken"}
                  </h4>
                  {otherCycles.length === 0 ? (
                    <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                      This will be the first, so any dates you like are free.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {otherCycles.map((cycle) => (
                        <li key={cycle.id} className="text-[13px] text-dim">
                          <span className="text-ink">{cycle.name}</span>{" "}
                          <span className="tabular-nums">{windowOf(cycle)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p className={`mt-1.5 ${CARD_HINT}`}>
              Here is what you are about to {mode === "create" ? "add" : "save"}.
            </p>
            <dl className="mt-4 border-t border-rule-soft">
              <div className={`${ROW} items-baseline`}>
                <dt className={FIELD_LABEL}>Name</dt>
                <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-ink">{trimmedName}</span>
                  <button type="button" onClick={() => setStep(1)} className={ROW_ACTION}>
                    Change<span className="sr-only"> the name</span>
                  </button>
                </dd>
              </div>
              <div className={`${ROW} items-baseline`}>
                <dt className={FIELD_LABEL}>First and last day</dt>
                <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm tabular-nums text-ink">
                    {range ? describeSpan(range.from, range.to) : "—"}
                  </span>
                  <button type="button" onClick={() => setStep(2)} className={ROW_ACTION}>
                    Change<span className="sr-only"> the dates</span>
                  </button>
                </dd>
              </div>
            </dl>
            <div className="mt-4 rounded-inset bg-paper px-4 py-3">
              <h4 className="text-[13px] font-medium text-ink">What saving does</h4>
              <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                {mode === "create"
                  ? "The cycle joins the list and Team analytics can compare it straight away. Emails sent between these two days count towards it; none of them are changed. You can move the dates or delete the cycle from this page at any time."
                  : "The cycle keeps its name and its emails, and the dates decide which of them count. Emails outside the new dates stop counting towards it; none of them are changed."}
              </p>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-rule-soft pt-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(step === 3 ? 2 : 1)}
                className={QUIET_BUTTON}
              >
                <ArrowLeft aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
                Back<span className="sr-only"> to the previous question</span>
              </button>
            )}
            <button type="button" onClick={onCancel} className={QUIET_BUTTON}>
              Cancel
            </button>
          </div>

          {step === 1 && (
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!nameReady}
              className={PRIMARY_BUTTON}
            >
              Continue
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!datesReady}
              className={PRIMARY_BUTTON}
            >
              Continue
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={() =>
                range && onSubmit({ name: trimmedName, startsOn: range.from, endsOn: range.to })
              }
              disabled={pending}
              aria-busy={pending || undefined}
              className={PRIMARY_BUTTON}
            >
              {pending && (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" strokeWidth={2.2} />
              )}
              {mode === "create" ? "Save cycle" : "Save changes"}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * The cycles list, and the define/edit flow behind it.
 *
 * Admin-only writes behind a read-only viewer mode: with `readOnly` the list,
 * the status of each cycle and the taken date ranges all render as normal,
 * and every button that would write stays off the page (the page states why
 * once, above this).
 */
export function CyclesPanel({ cycles, readOnly = false }: { cycles: CycleSummary[]; readOnly?: boolean }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CycleSummary | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (
    action: () => Promise<{ ok: boolean; message: string }>,
    options?: { after?: () => void; busyId?: string },
  ) => {
    setNotice(null);
    setBusyId(options?.busyId ?? null);
    startTransition(async () => {
      let result: { ok: boolean; message: string };
      try {
        result = await action();
      } catch {
        setBusyId(null);
        setNotice({ tone: "error", text: "That could not be saved. Try again." });
        return;
      }
      setBusyId(null);
      setNotice(
        result.ok
          ? { tone: "success", text: result.message }
          : { tone: "error", text: result.message },
      );
      if (!result.ok) return;
      options?.after?.();
      router.refresh();
    });
  };

  const closeWizard = () => {
    setCreateOpen(false);
    setEditing(null);
  };

  const save = (values: CycleValues) => {
    if (editing) {
      run(() => updateCycle({ id: editing.id, ...values }), { after: closeWizard });
      return;
    }
    run(() => createCycle(values), { after: closeWizard });
  };

  const inWizard = !readOnly && (createOpen || editing !== null);

  return (
    <>
      {notice && (
        <Rise>
          <p
            aria-live="polite"
            role={notice.tone === "error" ? "alert" : undefined}
            className={`flex items-center gap-1.5 rounded-panel border px-4 py-3 text-[13px] font-semibold ${
              notice.tone === "error"
                ? "border-stop/30 bg-stop-wash text-stop"
                : "border-go/30 bg-go-wash text-go"
            }`}
          >
            {notice.tone === "success" && (
              <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
            )}
            {notice.text}
          </p>
        </Rise>
      )}

      <Rise>
        {inWizard ? (
          <section aria-labelledby="cycle-wizard-heading" className={CARD}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h2 id="cycle-wizard-heading" className={CARD_TITLE}>
                {editing ? `Edit “${editing.name}”` : "Define a new cycle"}
              </h2>
              <button type="button" onClick={closeWizard} className={QUIET_BUTTON}>
                <ArrowLeft aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
                Back to the list
              </button>
            </div>
            {/* Keyed on what is being answered, so opening the flow for a
                different cycle starts it at question one rather than
                resuming whatever step the last one got to. */}
            <CycleWizard
              key={editing?.id ?? "new-cycle"}
              mode={editing ? "edit" : "create"}
              initialValues={{
                name: editing?.name ?? "",
                startsOn: editing?.startsOn ?? "",
                endsOn: editing?.endsOn ?? "",
              }}
              cycles={cycles.map(asCycle)}
              ignoreId={editing?.id}
              pending={isPending}
              onCancel={closeWizard}
              onSubmit={save}
            />
          </section>
        ) : (
          <section aria-labelledby="cycles-heading" className={CARD}>
            <h2 id="cycles-heading" className={CARD_TITLE}>
              Defined cycles
            </h2>
            <p className={CARD_HINT}>
              The named stretches of time Team analytics compares. An email counts
              towards the cycle holding the day it was sent, so nothing needs
              moving when a cycle is defined.
            </p>

            {cycles.length === 0 ? (
              <div className="mt-4 rounded-inset bg-paper px-4 py-3.5">
                <p className="text-sm text-ink">No cycles defined yet</p>
                <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                  {readOnly
                    ? "Until an admin defines one, Team analytics can only show figures across all time."
                    : "Until one exists, Team analytics can only show figures across all time. Defining one takes a name and two dates."}
                </p>
              </div>
            ) : (
              <ul className="mt-4 border-t border-rule-soft">
                {cycles.map((cycle) => {
                  const confirming = confirmingDeleteId === cycle.id;
                  const pill = PHASE_PILL[cycle.phase];
                  return (
                    <li key={cycle.id} className={`${ROW} items-start`}>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-medium text-ink">
                          {cycle.name}
                          <Pill tone={pill.tone}>
                            {cycle.phase === "upcoming"
                              ? `Starts ${formatShortDate(cycle.startsOn)}`
                              : pill.label}
                          </Pill>
                        </p>
                        <p className="mt-1 text-[13px] tabular-nums text-dim">{cycle.windowLabel}</p>

                        {confirming && (
                          <div className="mt-3 rounded-inset bg-stop-wash px-3 py-2.5">
                            <p className="text-[13px] leading-[1.55] text-stop">
                              Delete “{cycle.name}”? Emails and numbers are untouched
                              — only the label goes, and any comparison that used it
                              stops being available. Define it again with the same
                              dates to put it back.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  run(() => deleteCycle({ id: cycle.id }), {
                                    after: () => setConfirmingDeleteId(null),
                                    busyId: cycle.id,
                                  })
                                }
                                disabled={isPending}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-inset border border-stop bg-stop px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                              >
                                {busyId === cycle.id && (
                                  <Loader2
                                    aria-hidden="true"
                                    className="size-3 animate-spin"
                                    strokeWidth={2.4}
                                  />
                                )}
                                Yes, delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                                disabled={isPending}
                                className={QUIET_BUTTON}
                              >
                                Keep it
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {!readOnly && !confirming && (
                        <div className="flex shrink-0 items-center gap-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setNotice(null);
                              setConfirmingDeleteId(null);
                              setCreateOpen(false);
                              setEditing(cycle);
                            }}
                            className={ROW_ACTION}
                          >
                            Edit<span className="sr-only"> {cycle.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNotice(null);
                              setEditing(null);
                              setCreateOpen(false);
                              setConfirmingDeleteId(cycle.id);
                            }}
                            className="cursor-pointer rounded-inset px-2 py-0.5 text-[13px] font-medium text-stop transition-colors hover:bg-stop-wash focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
                          >
                            Delete<span className="sr-only"> {cycle.name}</span>
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {!readOnly && (
              <div className="mt-5 border-t border-rule-soft pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setConfirmingDeleteId(null);
                    setEditing(null);
                    setCreateOpen(true);
                  }}
                  className={PRIMARY_BUTTON}
                >
                  <Plus aria-hidden="true" className="size-3.5" strokeWidth={2.6} />
                  Define a new cycle
                </button>
                <p className={`mt-2 ${FOOTNOTE}`}>
                  Three short questions — a name, a first day, a last day — then a
                  chance to check it over before it is saved.
                </p>
              </div>
            )}
          </section>
        )}
      </Rise>
    </>
  );
}
