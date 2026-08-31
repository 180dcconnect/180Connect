"use client";

import { useState, useTransition } from "react";
import { completeActionAction } from "./actions";

/**
 * F171 AC1 — "directly from the Actions tab", no confirmation dialog or
 * separate page: one button, on the row itself. Kept as a sibling of the
 * row's own client-linking `<Link>` rather than nested inside it — a
 * `<button>` inside an `<a>` is invalid HTML and makes the click target
 * ambiguous (which one fires?).
 */
export function CompleteActionButton({ actionId }: { actionId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await completeActionAction(actionId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="shrink-0 rounded-full border border-brand/30 px-3 py-1.5 text-xs font-bold text-brand transition-colors hover:bg-brand/5 disabled:opacity-50"
      >
        {isPending ? "Completing…" : "Mark complete"}
      </button>
      {error && (
        <p role="alert" className="max-w-[14rem] text-right text-[11px] font-bold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
