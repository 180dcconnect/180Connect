"use client";

import { useRef, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { FaceRating } from "@/components/spectrumui/face-rating";
import { submitFeedback, dismissFeedback } from "@/lib/feedback-actions";
import { RATING_LABELS } from "@/lib/feedback";
import { OriginButton } from "@/components/ui/origin-button";

/**
 * A non-blocking floating card that asks the user to rate their experience.
 *
 * Anchored to the bottom-right of the dashboard page, above the fold. It never
 * blocks work — it floats beside the content, and a single click dismisses it.
 * The face-rating component (Spectrum UI) provides the 1–5 scale; an optional
 * comment textarea sits beneath it.
 *
 * After submit: card stays on thank-you state for 5s (or until dismissed via X), then animates out.
 * After dismiss: card animates out, prompt snoozed 30 days. It comes back later.
 *
 * Motion follows the design system: entrance is a blur-up rise, exit reverses.
 */
export function FeedbackPrompt({ pageContext }: { pageContext?: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [visible, setVisible] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const reduceMotion = useReducedMotion();
  // `setTimeout` returns a number in the browser (and under react-native's
  // global types, which the vendored CherryBlossomQRCode component pulls in),
  // but NodeJS.Timeout when only node types are loaded. Derive the handle type
  // instead of pinning either, so both resolve.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSubmit = () => {
    if (rating === 0) return;
    startTransition(async () => {
      const result = await submitFeedback(
        rating,
        comment || undefined,
        pageContext,
      );
      if (result.ok) {
        setSubmitted(true);
        // Show the thank-you state for 5 seconds, then animate out
        dismissTimerRef.current = setTimeout(() => setVisible(false), 5000);
      }
    });
  };

  const handleDismiss = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    startTransition(async () => {
      if (!submitted) {
        await dismissFeedback();
      }
      setVisible(false);
    });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20, filter: "blur(8px)", scale: 0.97 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, filter: "blur(6px)", scale: 0.97 }}
          transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
          className="fixed bottom-6 right-6 z-30 w-[340px] sm:w-[360px]"
        >
          <div className="relative rounded-2xl border border-black/[0.06] bg-white px-6 py-5 shadow-lg shadow-black/[0.06]">
            {/* Close button */}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Close"
              className="absolute right-3.5 top-3.5 flex h-7 w-7 items-center justify-center rounded-full text-foreground/40 transition-colors hover:bg-black/5 hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/20"
            >
              <X className="h-4 w-4" />
            </button>

            {submitted ? (
              /* ── Thank-you state ─────────────────────────────────── */
              <div className="flex flex-col items-center gap-2 py-3 pr-2">
                <span className="text-2xl" role="img" aria-label="Thank you">
                  🙏
                </span>
                <p className="text-sm font-bold text-foreground/80">
                  Thanks for your feedback!
                </p>
                <p className="text-xs text-foreground/50">
                  We&apos;ll use it to make 180Connect better.
                </p>
              </div>
            ) : (
              /* ── Rating form ─────────────────────────────────────── */
              <>
                <h3 className="mt-1 text-base font-extrabold tracking-tight text-foreground/90">
                  How&apos;s your experience?
                </h3>
                <p className="mt-1 text-xs leading-[1.6] text-foreground/50">
                  Rate your experience so far.
                </p>

                <div className="mt-4 flex justify-center">
                  <FaceRating
                    value={rating}
                    onValueChange={setRating}
                    labels={RATING_LABELS as unknown as [string, string, string, string, string]}
                    size="md"
                    label="How was your experience?"
                  />
                </div>

                <div className="mt-4">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Anything else? (optional)"
                    maxLength={280}
                    rows={2}
                    className="w-full resize-none rounded-xl border border-black/[0.08] bg-[#f4f4ef]/60 px-3 py-2 text-sm leading-[1.6] text-foreground/80 placeholder:text-foreground/30 focus:border-black/15 focus:outline-none focus:ring-0"
                  />
                  {comment.length > 0 && (
                    <p className="mt-0.5 text-right text-[10px] tabular-nums text-foreground/30">
                      {comment.length}/280
                    </p>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleDismiss}
                    disabled={isPending}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-foreground/45 transition-colors hover:bg-black/[0.04] hover:text-foreground/75 disabled:opacity-50"
                  >
                    Not now
                  </button>
                  <OriginButton
                    type="button"
                    onClick={handleSubmit}
                    disabled={rating === 0 || isPending}
                    loading={isPending}
                    size="sm"
                    variant="default"
                  >
                    Send feedback
                  </OriginButton>
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
