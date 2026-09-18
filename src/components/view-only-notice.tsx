"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Eye } from "lucide-react";

import { VIEW_ONLY_EVENT, VIEW_ONLY_REFUSED_COOKIE } from "@/lib/auth/view-only";

/**
 * The notice a viewer sees when they press something that would change data.
 *
 * Mounted once per shell, and only for viewers. It does not decide anything:
 * the server has already refused the write and set a short-lived cookie saying
 * so (src/lib/auth/view-only.ts). This watches for that cookie after every
 * request the page makes — server actions and API routes alike go through
 * `fetch` — and opens the notice when it appears, so no individual button needs
 * to know viewers exist.
 */
export function ViewOnlyNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const cookiePrefix = `${VIEW_ONLY_REFUSED_COOKIE}=`;

    function showIfRefused() {
      const refused = document.cookie
        .split(";")
        .some((part) => part.trim().startsWith(cookiePrefix));
      if (!refused) return;
      document.cookie = `${VIEW_ONLY_REFUSED_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
      setOpen(true);
    }

    const originalFetch = window.fetch;
    const watchedFetch: typeof window.fetch = async (...args) => {
      try {
        return await originalFetch(...args);
      } finally {
        showIfRefused();
      }
    };
    window.fetch = watchedFetch;
    // A refusal that landed during a full page navigation.
    showIfRefused();

    const handleTrigger = () => setOpen(true);
    window.addEventListener(VIEW_ONLY_EVENT, handleTrigger);

    return () => {
      if (window.fetch === watchedFetch) window.fetch = originalFetch;
      window.removeEventListener(VIEW_ONLY_EVENT, handleTrigger);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="view-only-backdrop"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/25 p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="view-only-title"
            aria-describedby="view-only-body"
            className="w-full max-w-[380px] rounded-panel border border-rule bg-white p-5 shadow-[0_24px_60px_-20px_rgba(15,23,42,0.45)]"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <Eye className="mt-0.5 h-[15px] w-[15px] shrink-0 text-faint" aria-hidden />
              <div className="min-w-0">
                <h2
                  id="view-only-title"
                  className="text-[18px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink"
                >
                  You have view-only access
                </h2>
                <p id="view-only-body" className="mt-2 text-sm leading-[1.65] text-dim">
                  You can look around everything, but your account can&rsquo;t change
                  client details, import data or send emails. Nothing was saved or
                  sent. If something needs doing, ask an admin.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-inset bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90"
              >
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
