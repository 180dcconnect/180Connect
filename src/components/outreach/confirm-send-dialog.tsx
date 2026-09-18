"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, X } from "lucide-react";

/**
 * The commit gate for a straight "Send reviewed email" — the one send action
 * that does not pick a time.
 *
 * The approval checkbox is the review gate. This dialog is the commit gate: a
 * stray tap on the paper plane asks before anything leaves the building. It
 * mirrors ScheduleSendDialog's three-step shape (pick/confirm/done) collapsed
 * to one real question, so the two send paths share one confirmation idiom
 * rather than one being a dialog and the other being a native `confirm()`.
 *
 * The dialog only asks. Committing it is the caller's job — on the client
 * record that means `sendReviewedEmail`, which re-checks approval, suppression,
 * ownership and rate limits server-side regardless.
 */
type Step = "confirm" | "done";

export function ConfirmSendDialog({
  open,
  onClose,
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once the CAM has confirmed. The caller owns the network call. */
  onConfirm: () => void | Promise<void>;
  /** Set while the caller is committing, so the confirm button cannot be pressed twice. */
  pending?: boolean;
}) {
  const [step, setStep] = useState<Step>("confirm");

  // Escape closes the dialog, except on the done step — the send is already
  // underway by then, and the acknowledgement is the only place that says so.
  useEffect(() => {
    if (!open || step === "done") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  function close() {
    setStep("confirm");
    onClose();
  }

  async function confirm() {
    await onConfirm();
    setStep("done");
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-5"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          key="confirm-send-backdrop"
          onClick={step === "done" ? undefined : close}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            aria-label="Confirm send"
            className="w-full max-w-[340px] overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]"
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between border-b border-slate-900/8 px-4 py-3">
              <span className="font-body text-[13px] font-medium text-slate-900">
                {step === "confirm" ? "Send this email?" : "Email sent"}
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

            {step === "confirm" && (
              <div className="px-4 py-4">
                <p className="text-[13px] leading-[1.6] text-slate-700">
                  Confirm you want to send this email now. It will leave from the
                  Sheffield outreach mailbox and cannot be edited after that.
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-100"
                    disabled={pending}
                    onClick={close}
                    type="button"
                  >
                    Keep editing
                  </button>
                  <button
                    className="cursor-pointer rounded-md bg-lead px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1b3160] disabled:opacity-50"
                    disabled={pending}
                    onClick={confirm}
                    type="button"
                  >
                    {pending ? "Sending…" : "Yes, send it"}
                  </button>
                </div>
              </div>
            )}

            {step === "done" && (
              <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-5 w-5 text-emerald-600" />
                </span>
                <p className="text-[13px] font-semibold text-slate-900">
                  Sending now
                </p>
                <p className="text-[11px] text-slate-500">
                  The email is on its way. You can close this window.
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
