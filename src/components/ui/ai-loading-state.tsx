"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * Cycling status line + pulsing dots for a one-shot AI generation that can run
 * anywhere from ~1-20s — long enough that a static "Generating…" line reads as
 * stalled. Shared by BookletPanel and ComposeButton, the app's two Gemini-backed
 * generate actions, so both read the same rather than drifting apart.
 */
export function AiLoadingState({
  messages,
  reducedMotionLabel,
}: {
  messages: readonly string[];
  reducedMotionLabel: string;
}) {
  const reducedMotion = useReducedMotion();
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const interval = setInterval(() => {
      setMessageIndex((current) => (current + 1) % messages.length);
    }, 3200);
    return () => clearInterval(interval);
  }, [reducedMotion, messages.length]);

  return (
    <div aria-live="polite" className="mt-5 flex items-center gap-3">
      <div aria-hidden="true" className="flex gap-1.5">
        {[0, 1, 2].map((dot) => (
          <motion.span
            animate={reducedMotion ? undefined : { opacity: [0.25, 1, 0.25], y: [0, -4, 0] }}
            className="h-2 w-2 rounded-full bg-brand"
            key={dot}
            transition={{ duration: 1, repeat: Infinity, delay: dot * 0.15, ease: "easeInOut" }}
          />
        ))}
      </div>
      {reducedMotion ? (
        <p className="text-sm font-medium text-foreground/70">{reducedMotionLabel}</p>
      ) : (
        <AnimatePresence mode="wait">
          <motion.p
            animate={{ opacity: 1, y: 0 }}
            className="text-sm font-medium text-foreground/70"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: 4 }}
            key={messageIndex}
            transition={{ duration: 0.35 }}
          >
            {messages[messageIndex]}
          </motion.p>
        </AnimatePresence>
      )}
    </div>
  );
}
