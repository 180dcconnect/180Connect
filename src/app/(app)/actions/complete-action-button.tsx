"use client";

import { useState, useTransition } from "react";
import { OriginButton } from "@/components/ui/origin-button";
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
      <OriginButton
        type="button"
        onClick={handleClick}
        disabled={isPending}
        loading={isPending}
        size="sm"
        variant="outline"
        className="shrink-0"
      >
        {isPending ? "Completing…" : "Mark complete"}
      </OriginButton>
      {error && (
        <p role="alert" className="text-right font-body text-[12px] font-semibold text-stop">
          {error}
        </p>
      )}
    </div>
  );
}
