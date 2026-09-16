"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { recheckWebsiteAction } from "./website-actions";

/**
 * Explicit retry for the Contactability card's cached website verdict.
 *
 * `loadWebsite` serves a 1hr `unstable_cache`, so a transient outage — or a
 * checker false negative — sticks on screen with no way to ask again. This
 * runs a fresh check of the stored URL, busts the cache tag, and refreshes
 * the record so the card re-renders with the new verdict.
 */
export function WebsiteRetryButton({ organisationId }: { organisationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await recheckWebsiteAction({ organisationId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="mt-2 inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-rule bg-white px-2.5 py-1 text-[12px] font-semibold text-lead transition-colors hover:border-lead focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        <RefreshCw aria-hidden="true" className={`size-3 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Checking…" : "Retry check"}
      </button>
      {error && (
        <span className="text-[12px] font-medium text-stop" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
