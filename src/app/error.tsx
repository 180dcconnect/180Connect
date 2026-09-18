"use client"; // Error boundaries must be Client Components.

/**
 * Segment-level error boundary (F236). Sibling to global-error.tsx, not a
 * replacement — that one only catches root-*layout* errors and has to render its
 * own <html>/<body> because it replaces the layout. This one wraps everything
 * under the root layout (every route), so it can rely on globals.css already
 * being loaded and render normal app chrome.
 *
 * This is a safety net for genuine thrown/render exceptions only. It does not
 * address pages that catch a Supabase query error and render on regardless —
 * those never throw, so this boundary never sees them; they're fixed at the
 * page level with InlineAlert instead.
 */

import { useEffect } from "react";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    void reportError(error, {
      context: { source: "segment-error-boundary", digest: error.digest },
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f4ef] px-6">
      <div className="w-full max-w-md rounded-2xl border border-black/[0.06] bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-black tracking-[-0.02em]">Something went wrong</h1>
        <div className="mt-3">
          <InlineAlert
            variant="inline"
            message="An unexpected error interrupted this page. The problem has been logged and the team will look into it. You can try again."
          />
        </div>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-6 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white"
        >
          Try again
        </button>
        {error.digest ? (
          <p className="mt-6 text-xs text-foreground/40">Reference: {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
