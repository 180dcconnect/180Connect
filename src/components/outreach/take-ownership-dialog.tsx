"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

export type ClaimOwnershipResult = { ok: true } | { ok: false; message: string };

/**
 * Claims an unowned client for the sender, through the profile's claim route
 * — the single audited door (claim_organisation RPC). Shared by the compose
 * modal and the reply composer so the two send surfaces cannot drift apart:
 * every client in outreach ends up with an owner, claimed explicitly at send
 * time rather than as a silent side effect.
 *
 * A 409 means someone else owns the client now (the directory hint that
 * opened the dialog was stale): the caller must stop the send, not override.
 * Anything else refused surfaces the route's own message, which is written
 * to be read by a CAM.
 */
export async function claimClientOwnership(
  organisationId: string,
): Promise<ClaimOwnershipResult> {
  try {
    const response = await fetch(`/api/clients/${organisationId}/claim`, {
      method: "POST",
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    return {
      ok: false,
      message:
        response.status === 409
          ? "This client was just claimed by another team member. Nothing was sent."
          : (body?.error ?? "Ownership could not be confirmed. Nothing was sent."),
    };
  } catch {
    return {
      ok: false,
      message: "Could not reach the server. Check your connection and try again.",
    };
  }
}

/**
 * Take-ownership confirmation both send surfaces mount: sending to an
 * unowned client makes the sender its owner, stated plainly with an explicit
 * confirm — Cancel claims nothing and sends nothing, and the composer keeps
 * everything that was typed.
 *
 * Deliberately separate from the approval control ("I have reviewed the
 * recipient, subject and body"), which stays solely in EmailReviewPanel —
 * see lib/outreach/human-send-control.test.ts.
 */
export function TakeOwnershipDialog({
  open,
  orgName,
  claiming,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  orgName: string;
  /** Set while the caller is claiming, so confirm cannot be pressed twice. */
  claiming: boolean;
  onCancel: () => void;
  /** Called once the CAM has confirmed. The caller owns the claim call. */
  onConfirm: () => void | Promise<void>;
}) {
  // Escape backs out exactly like Cancel — the caller must treat an
  // in-flight claim as aborted (see the abort refs at the call sites), so a
  // late claim success can never send after the CAM walked away.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="take-ownership-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-5"
          onClick={onCancel}
        >
          <motion.div
            role="dialog"
            aria-label="Take ownership before sending"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[320px] overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]"
          >
            <div className="flex items-center justify-between border-b border-slate-900/8 px-4 py-3">
              <span className="text-[13px] font-bold text-slate-900">Take ownership?</span>
              <button
                type="button"
                onClick={onCancel}
                className="p-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                title="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <p className="px-4 py-3 text-[12px] leading-[1.5] text-slate-500">
              <span className="font-semibold text-slate-700">{orgName}</span> has no
              owner. Sending this email will make you its owner, so future outreach
              stays with one person.
            </p>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-900/8 px-4 py-3">
              <button
                type="button"
                disabled={claiming}
                onClick={onCancel}
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={claiming}
                onClick={() => void onConfirm()}
                className="rounded-lg bg-lead px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1b3160] cursor-pointer disabled:opacity-50 disabled:cursor-wait"
              >
                {claiming ? "Taking ownership…" : "Send and take ownership"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
