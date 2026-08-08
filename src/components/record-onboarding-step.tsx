"use client";

import { useEffect, useRef } from "react";
import { recordOnboardingStepAction } from "@/lib/onboarding-actions";

/**
 * F255 — marks a checklist step done because the CAM actually did the thing.
 *
 * Mounted on the screen that *is* the step, not on the button that links to it:
 * opening a page is not the same as completing it, and a checklist that ticks on
 * click would be lying by the second login. Step 2 ("review your assigned clients")
 * is the case that needs this — reviewing leaves no other trace — while step 1 is
 * recorded by the preferences save itself, where a real write already happens.
 *
 * The insert is idempotent server-side (unique constraint on user_id + step_key), so
 * a revisit costs one no-op round trip. The ref keeps React's development-mode double
 * mount from making that two.
 */
export function RecordOnboardingStep({ step }: { step: string }) {
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    // Fire and forget: this is bookkeeping behind a page the CAM is already reading,
    // and a failure here must never interrupt or block what they came to do. The
    // action reports its own errors to ERROR_LOG.
    void recordOnboardingStepAction(step);
  }, [step]);

  return null;
}
