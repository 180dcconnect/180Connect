"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, Check, X } from "lucide-react";

/**
 * Choosing when a reviewed email goes out: three presets, a pick-your-own row,
 * then a confirmation the CAM cannot skip.
 *
 * Lifted from the inbox compose window (src/components/inbox/gmail-compose-modal.tsx)
 * so the client record's Introductory email card asks the question the same way
 * — same presets, same wording, same three steps. It replaced a bare
 * `datetime-local` input, which asked for an instant without ever saying that
 * scheduling is a commitment: a scheduled send cannot be edited, it goes out on
 * its own, and the confirm step is where that is said out loud.
 *
 * The dialog only picks a time. Committing it is the caller's job — on the
 * client record that means `scheduleReviewedEmail`, which re-checks approval,
 * suppression and ownership server-side.
 */

/** The presets offered before "Pick date & time": the next two slots tomorrow,
    then the following Monday morning.

    On a Sunday, "Monday morning" and "Tomorrow morning" are the same instant,
    and offering the same time twice under two names makes the list read as
    broken. The Monday row is dropped in that case rather than duplicated. */
export function scheduleSuggestions(now: Date = new Date()): Array<{
  id: string;
  label: string;
  when: Date;
}> {
  const at = (daysAhead: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + daysAhead);
    date.setHours(hour, 0, 0, 0);
    return date;
  };

  // Days until the next Monday that is not today.
  const toMonday = ((8 - now.getDay()) % 7) || 7;

  const suggestions = [
    { id: "tomorrow-am", label: "Tomorrow morning", when: at(1, 8) },
    { id: "tomorrow-pm", label: "Tomorrow afternoon", when: at(1, 13) },
  ];
  if (toMonday > 1) {
    suggestions.push({ id: "monday-am", label: "Monday morning", when: at(toMonday, 8) });
  }
  return suggestions;
}

export function formatScheduleTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Spelled-out form for the confirmation step: "Friday, 6 September at 09:00". */
export function formatScheduleLong(date: Date): string {
  const day = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} at ${time}`;
}

/** `datetime-local` wants wall-clock text, not an ISO instant. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type Step = "pick" | "confirm" | "done";

export function ScheduleSendDialog({
  open,
  onClose,
  onConfirm,
  /** Rendered on the done step instead of the default acknowledgement, so a
      caller whose commit can fail can say what actually happened. */
  doneMessage,
  /** Set while the caller is committing the chosen time, so the confirm button
      cannot be pressed twice. */
  committing = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once the CAM has confirmed. Resolve true to show the done step,
      false to hand control back so the caller can show its own error. */
  onConfirm: (when: Date) => Promise<boolean> | boolean;
  doneMessage?: string;
  committing?: boolean;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [pendingWhen, setPendingWhen] = useState<Date | null>(null);
  const [customWhen, setCustomWhen] = useState<string | null>(null);

  const suggestions = scheduleSuggestions();

  // Escape closes the dialog, except on the done step — the send is already
  // queued by then, and the acknowledgement is the only place that says so.
  useEffect(() => {
    if (!open || step === "done") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  function reset() {
    setStep("pick");
    setPendingWhen(null);
    setCustomWhen(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function confirm() {
    if (!pendingWhen) return;
    const committed = await onConfirm(pendingWhen);
    if (committed) {
      setStep("done");
      return;
    }
    // The caller refused or failed — hand the CAM back to the picker rather
    // than claiming a send is queued when it is not.
    setStep("pick");
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-5"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          key="schedule-backdrop"
          onClick={step === "done" ? undefined : close}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            aria-label="Schedule send"
            className="w-full max-w-[340px] overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]"
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between border-b border-slate-900/8 px-4 py-3">
              <span className="font-body text-[13px] font-medium text-slate-900">
                {step === "pick"
                  ? "Schedule send"
                  : step === "confirm"
                    ? "Confirm scheduled send"
                    : "Send scheduled"}
              </span>
              <button
                className="cursor-pointer rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={close}
                title={step === "done" ? "Done" : "Close"}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {step === "pick" && (
              <>
                <ul className="py-1">
                  {suggestions.map((suggestion) => (
                    <li key={suggestion.id}>
                      <button
                        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                        onClick={() => {
                          setPendingWhen(suggestion.when);
                          setStep("confirm");
                        }}
                        type="button"
                      >
                        <span className="text-[13px] text-slate-800">{suggestion.label}</span>
                        <span className="shrink-0 text-[11px] text-slate-500">
                          {formatScheduleTime(suggestion.when)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="border-t border-slate-900/8 px-4 py-3">
                  {customWhen === null ? (
                    <button
                      className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-lead hover:underline"
                      onClick={() =>
                        setCustomWhen(toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)))
                      }
                      type="button"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Pick date &amp; time
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        aria-label="Send date and time"
                        className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-[12px] text-slate-800 focus:border-lead focus:outline-none"
                        // F126: the input itself refuses a past instant, and
                        // scheduleReviewedEmail refuses one again server-side.
                        min={toLocalInputValue(new Date())}
                        onChange={(event) => setCustomWhen(event.target.value)}
                        type="datetime-local"
                        value={customWhen}
                      />
                      <button
                        className="shrink-0 cursor-pointer rounded-md bg-lead px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1b3160] disabled:opacity-50"
                        disabled={!customWhen}
                        onClick={() => {
                          setPendingWhen(new Date(customWhen));
                          setStep("confirm");
                        }}
                        type="button"
                      >
                        Schedule
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {step === "confirm" && pendingWhen && (
              <div className="px-4 py-4">
                <p className="text-[13px] leading-[1.6] text-slate-700">
                  Confirm you want to schedule this send. Once scheduled you won&rsquo;t be
                  able to edit the message &mdash; it goes out on its own.
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-900">
                  <CalendarClock className="h-3.5 w-3.5 text-lead" />
                  {formatScheduleLong(pendingWhen)}
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-100"
                    disabled={committing}
                    onClick={() => {
                      setStep("pick");
                      setPendingWhen(null);
                    }}
                    type="button"
                  >
                    Keep editing
                  </button>
                  <button
                    className="cursor-pointer rounded-md bg-lead px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1b3160] disabled:opacity-50"
                    disabled={committing}
                    onClick={confirm}
                    type="button"
                  >
                    {committing ? "Scheduling…" : "I understand, schedule it"}
                  </button>
                </div>
              </div>
            )}

            {step === "done" && pendingWhen && (
              <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-5 w-5 text-emerald-600" />
                </span>
                <p className="text-[13px] font-semibold text-slate-900">
                  Scheduled for {formatScheduleLong(pendingWhen)}
                </p>
                <p className="text-[11px] text-slate-500">
                  {doneMessage ??
                    "The message will send automatically. You can cancel it from the Scheduled folder before then."}
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
