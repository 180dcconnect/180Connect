"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, TriangleAlert, X } from "lucide-react";

/**
 * The signed-in app's confirmation toast: a short line, bottom-right, that says
 * what just happened and gets out of the way.
 *
 * ── Why this exists ──
 *
 * A save used to confirm itself only where it was made — the word "Saved" next
 * to the field, in the card that was just edited. That reads fine when the eye
 * is already there, and not at all when the save happened in a row that closed
 * on success or scrolled away under a long list. The rule the admin screens are
 * held to (AGENTS.md) is that a change should be visible and undoable from the
 * same screen; being visible comes first.
 *
 * The visual language is the inbox shell's own toast — ink panel, white text,
 * a tick — so the app confirms things one way rather than two. The inbox keeps
 * its local copy because that one is anchored inside the mail surface and
 * carries the Undo window for a send; this one is the ordinary case.
 *
 * ── Contract ──
 *
 *   * `useToast().showToast(message)` from any client component under the app
 *     shell. Nothing to mount per screen.
 *   * Auto-dismissed, dismissible, and stacked newest-first to a small cap, so
 *     a run of saves reads as a run rather than a wall.
 *   * `role="status"` on a polite live region: a screen reader hears the
 *     confirmation without being yanked out of the field it is in.
 */

export type ToastTone = "success" | "error";

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

/** How long a toast stays before it fades. Long enough to read twice. */
const TOAST_DURATION_MS = 4000;

/** Beyond this, older toasts drop off the top rather than filling the screen. */
const MAX_VISIBLE = 3;

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Reading the toaster from a component that might render outside the provider
 * (a preview route, a test harness) must not crash the tree — a missing
 * provider costs the confirmation, not the page. The save itself already
 * reported through its own inline note.
 */
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? { showToast: () => {} };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "success") => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current, { id, message, tone }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setToasts((current) => current.filter((toast) => toast.id !== id));
        }, TOAST_DURATION_MS),
      );
    },
    [],
  );

  // Every pending timer dies with the tree, so a navigation mid-toast leaves
  // nothing running.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-5 bottom-5 z-[90] flex flex-col items-end gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="pointer-events-auto flex max-w-[min(92vw,26rem)] items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-[0_18px_40px_-16px_rgba(15,23,42,0.6)]"
            >
              {toast.tone === "error" ? (
                <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-amber-300" />
              ) : (
                <Check aria-hidden="true" className="size-4 shrink-0 text-emerald-300" />
              )}
              <span className="min-w-0">{toast.message}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(toast.id)}
                className="ml-1 shrink-0 cursor-pointer rounded-full p-0.5 text-white/60 transition-colors hover:text-white"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
