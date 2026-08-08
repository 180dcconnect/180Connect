"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { dismissGuideAction, finishGuideAction } from "@/lib/onboarding-actions";

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
      const result = await action();
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
      className="mt-6 rounded-xl border border-brand/20 bg-brand/5 p-6"
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
            className="flex flex-wrap items-start justify-between gap-4 rounded-lg bg-white p-4"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-bold">
                <span
                  aria-hidden="true"
                  className={
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs " +
                    (step.done ? "bg-brand text-white" : "border border-black/15 text-transparent")
                  }
                >
                  ✓
                </span>
                <span className={step.done ? "text-foreground/55 line-through" : undefined}>
                  {step.title}
                </span>
                {/* The tick is decorative; screen readers get the state in words. */}
                <span className="sr-only">{step.done ? "(complete)" : "(not started)"}</span>
              </p>
              <p className="mt-1.5 text-sm text-foreground/65">{step.description}</p>
            </div>
            {/* AC3 — every step leads to the screen that does the thing. */}
            <Link
              href={step.href}
              className="shrink-0 rounded-full border border-brand/30 px-3 py-1 text-xs font-bold text-brand hover:bg-brand/5"
            >
              {step.cta}
            </Link>
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
          <button
            type="button"
            className="rounded-lg bg-brand px-5 py-2.5 font-bold text-white disabled:opacity-50"
            disabled={pending}
            onClick={() => run(finishGuideAction)}
          >
            {pending ? "Finishing…" : "Finish setup"}
          </button>
        ) : confirmingDismiss ? (
          <>
            {/* AC5 — dismissal is permanent, so it is stated before it happens rather
                than being an undo the CAM has to go looking for. */}
            <p className="text-sm text-foreground/75">
              Dismiss the setup guide? It won&apos;t come back, but you can still set your
              preferences from Settings at any time.
            </p>
            <button
              type="button"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              disabled={pending}
              onClick={() => run(dismissGuideAction)}
            >
              {pending ? "Dismissing…" : "Dismiss"}
            </button>
            <button
              type="button"
              className="text-sm font-bold text-foreground/65 hover:underline"
              disabled={pending}
              onClick={() => setConfirmingDismiss(false)}
            >
              Keep it
            </button>
          </>
        ) : (
          /* A named control rather than a bare ✕: AC5 wants dismissal to be
             deliberate and findable, and an icon alone is neither. */
          <button
            type="button"
            className="text-sm font-bold text-foreground/65 hover:underline"
            onClick={() => setConfirmingDismiss(true)}
          >
            Dismiss
          </button>
        )}
      </div>
    </section>
  );
}
