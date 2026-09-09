"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { LoaderPinwheel } from "@/components/animate-ui/icons/loader-pinwheel";
import type { StageOneDisplayStage, StageOneStreamStage } from "@/components/outreach/use-stage-one-draft-stream";

/**
 * What generation looks like while it runs: a thinking header (spinning
 * pinwheel, live elapsed seconds) over the real pipeline steps, each one
 * lighting up as the server actually reaches it.
 *
 * Replaces the old skeleton bars and cycling guesses. The steps are honest
 * on purpose — the free-tier model exposes no reasoning trace, so these are
 * the request's own milestones (sent → first token → body flowing → saving),
 * not a narration of the model's internals.
 */
const STEPS: ReadonlyArray<{ key: StageOneStreamStage; label: string }> = [
  { key: "reading", label: "Reading booklet & profile" },
  { key: "drafting", label: "Drafting your email" },
  { key: "saving", label: "Saving draft" },
];

/** 59s, then 1m 0s, 1m 1s — never 60s, 61s. */
function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}
function stepState(
  step: StageOneStreamStage,
  stage: StageOneDisplayStage | null,
): "done" | "active" | "pending" {
  const order: StageOneDisplayStage[] = ["reading", "drafting", "saving", "done"];
  if (!stage) return "pending";
  const at = order.indexOf(stage);
  const mine = order.indexOf(step);
  if (mine < at) return "done";
  if (mine === at) return "active";
  return "pending";
}

export function AiThinkingState({
  stage,
  startedAt,
  heading = "Thinking",
}: {
  stage: StageOneDisplayStage | null;
  /** Epoch ms generation began. Null on the first render before it is set. */
  startedAt: number | null;
  heading?: string;
}) {
  const reducedMotion = useReducedMotion();
  // Render-safe fallback for the one frame before the hook reports back —
  // lazy initializer, so the compiler does not see an impure render call.
  const [fallbackStartedAt] = useState(() => Date.now());
  const base = startedAt ?? fallbackStartedAt;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - base) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [base]);

  return (
    <div aria-live="polite" className="mt-5">
      <div className="flex items-center gap-2.5">
        <LoaderPinwheel
          animate={stage !== "done"}
          size={16}
          className="shrink-0 text-lead"
          aria-hidden="true"
        />
        <p className="text-sm font-semibold text-foreground">
          {heading}
          <span className="ml-2 font-normal tabular-nums text-dim" aria-label={`${formatElapsed(elapsedSeconds)} elapsed`}>
            {formatElapsed(elapsedSeconds)}
          </span>
        </p>
      </div>
      <ul className="mt-3 space-y-1.5">
        {STEPS.map((step) => {
          const state = stepState(step.key, stage);
          return (
            <motion.li
              key={step.key}
              initial={false}
              animate={{ opacity: state === "pending" ? 0.45 : 1 }}
              className="flex items-center gap-2 text-[13px]"
            >
              <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                {state === "done" ? (
                  // Same draw-on tick as the approval checkbox
                  // (animate-ui checkbox indicator): the stroke draws itself,
                  // green, with no background behind it.
                  <motion.svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={3.5}
                    stroke="currentColor"
                    className="h-3.5 w-3.5 text-emerald-600"
                    initial={false}
                  >
                    <motion.path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                    />
                  </motion.svg>
                ) : state === "active" ? (
                  reducedMotion ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-lead" />
                  ) : (
                    <motion.span
                      animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.1, 0.85] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                      className="h-1.5 w-1.5 rounded-full bg-lead"
                    />
                  )
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-rule" />
                )}
              </span>
              <span className={state === "active" ? "font-semibold text-foreground" : "text-dim"}>
                {step.label}
                {state === "active" && <span aria-hidden="true">…</span>}
              </span>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
