"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, type Transition } from "motion/react";
import { OriginButton } from "@/components/ui/origin-button";
import { dismissGuideAction, finishGuideAction } from "@/lib/onboarding-actions";

const getPathAnimate = (isChecked: boolean) => ({
  pathLength: isChecked ? 1 : 0,
  opacity: isChecked ? 1 : 0,
});

const getPathTransition = (isChecked: boolean): Transition => ({
  pathLength: { duration: 0.8, ease: "easeInOut" },
  opacity: {
    duration: 0.01,
    delay: isChecked ? 0 : 0.8,
  },
});

/**
 * F255 — the first-run checklist a new CAM sees on their dashboard.
 *
 * Presentation only: which steps exist, whether each is done, and where each one
 * leads are all decided server-side (src/lib/onboarding.ts, and the dashboard page
 * for the empty-state variant of step 2). This component's own jobs are the two
 * writes that end the guide and keeping the ticks current without a page reload.
 *
 * Copy is signed off on #18 — changes go there first.
 */

export type GuideStep = {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
};

export function FirstRunGuide({
  steps,
  completedCount,
  allDone,
}: {
  steps: GuideStep[];
  completedCount: number;
  allDone: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * AC4 — a step is completed on another screen (preferences, the client list), so
   * the tick has to appear without the CAM reloading anything. Coming back to the
   * dashboard is a client-side navigation and re-renders on the server, which covers
   * the ordinary path; this covers the other one, where the dashboard is sitting in a
   * second tab while the work happens in the first. Refreshing only while steps are
   * outstanding keeps a finished guide from re-fetching on every focus.
   */
  useEffect(() => {
    if (allDone) return;
    function refreshOnReturn() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => document.removeEventListener("visibilitychange", refreshOnReturn);
  }, [allDone, router]);

  function run(action: () => Promise<{ ok: boolean }>) {
    setFailed(false);
    startTransition(async () => {
      let result: { ok: boolean };
      try {
        result = await action();
      } catch {
        setFailed(true);
        return;
      }
      if (!result.ok) {
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="first-run-guide-heading"
      className="rounded-2xl border border-brand/20 bg-brand/[0.05] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="first-run-guide-heading" className="text-lg font-bold">
            {allDone ? "You're set up." : "Welcome to 180 Connect"}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-foreground/75">
            {allDone
              ? "Your queue is ready — head to your clients to start outreach."
              : "Three minutes of setup and you're ready to start outreach. You can come back to this later — it stays here until you finish or dismiss it."}
          </p>
        </div>
        <p
          aria-live="polite"
          className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-foreground/65"
        >
          {completedCount} of {steps.length} complete
        </p>
      </div>

      <ol className="mt-5 space-y-3">
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex flex-wrap items-start justify-between gap-4 rounded-xl bg-white p-4 transition-all hover:shadow-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2.5 font-bold">
                <span
                  aria-hidden="true"
                  className={
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300 " +
                    (step.done
                      ? "bg-brand text-white"
                      : "border border-black/20 text-transparent")
                  }
                >
                  <motion.span
                    initial={false}
                    animate={{ scale: step.done ? 1 : 0, opacity: step.done ? 1 : 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    ✓
                  </motion.span>
                </span>
                <span className="relative inline-block max-w-full">
                  <span
                    className={
                      "transition-colors duration-300 " +
                      (step.done ? "text-foreground/50" : "text-foreground")
                    }
                  >
                    {step.title}
                  </span>
                  <motion.svg
                    width="340"
                    height="32"
                    viewBox="0 0 340 32"
                    className="pointer-events-none absolute left-0 top-1/2 z-20 h-7 w-full -translate-y-1/2"
                  >
                    <motion.path
                      d="M 10 16.91 s 79.8 -11.36 98.1 -11.34 c 22.2 0.02 -47.82 14.25 -33.39 22.02 c 12.61 6.77 124.18 -27.98 133.31 -17.28 c 7.52 8.38 -26.8 20.02 4.61 22.05 c 24.55 1.93 113.37 -20.36 113.37 -20.36"
                      vectorEffect="non-scaling-stroke"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeMiterlimit={10}
                      fill="none"
                      initial={false}
                      animate={getPathAnimate(step.done)}
                      transition={getPathTransition(step.done)}
                      className="stroke-brand"
                    />
                  </motion.svg>
                </span>
                {/* The tick is decorative; screen readers get the state in words. */}
                <span className="sr-only">{step.done ? "(complete)" : "(not started)"}</span>
              </p>
              <p className="mt-1.5 text-sm text-foreground/65">{step.description}</p>
            </div>
            {/* AC3 — every step leads to the screen that does the thing. */}
            <OriginButton
              href={step.href}
              size="sm"
              className="shrink-0"
            >
              {step.cta}
            </OriginButton>
          </li>
        ))}
      </ol>

      {failed && (
        <p className="mt-4 text-sm font-bold text-red-800" role="alert">
          That could not be saved. Try again.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {allDone ? (
          <OriginButton
            size="md"
            loading={pending}
            disabled={pending}
            onClick={() => run(finishGuideAction)}
          >
            {pending ? "Finishing…" : "Finish setup"}
          </OriginButton>
        ) : confirmingDismiss ? (
          <>
            {/* AC5 — dismissal is permanent, so it is stated before it happens rather
                than being an undo the CAM has to go looking for. */}
            <p className="text-sm text-foreground/75">
              Dismiss the setup guide? It won&apos;t come back, but you can still set your
              preferences from Settings at any time.
            </p>
            <OriginButton
              size="sm"
              variant="destructive"
              loading={pending}
              disabled={pending}
              onClick={() => run(dismissGuideAction)}
            >
              {pending ? "Dismissing…" : "Dismiss"}
            </OriginButton>
            <OriginButton
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmingDismiss(false)}
            >
              Keep it
            </OriginButton>
          </>
        ) : (
          /* A named control rather than a bare ✕: AC5 wants dismissal to be
             deliberate and findable, and an icon alone is neither. */
          <OriginButton
            size="xs"
            variant="ghost"
            onClick={() => setConfirmingDismiss(true)}
          >
            Dismiss
          </OriginButton>
        )}
      </div>
    </section>
  );
}
