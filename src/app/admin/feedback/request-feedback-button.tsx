"use client";

import { useState, useTransition } from "react";
import { requestFeedbackRound } from "@/lib/feedback-actions";

/**
 * Admin-only button: clears feedback_snoozed_until for every active user,
 * so the in-app prompt re-appears on their next dashboard visit.
 */
export function RequestFeedbackButton() {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const handleClick = () => {
    startTransition(async () => {
      const result = await requestFeedbackRound();
      if (result.ok) setDone(true);
    });
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700">
        <span aria-hidden="true">✓</span> Feedback round requested
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="shrink-0 rounded-full bg-[var(--brand,#72b744)] px-5 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100"
    >
      {isPending ? "Requesting…" : "Request feedback round"}
    </button>
  );
}
