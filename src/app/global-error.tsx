"use client"; // Error boundaries must be Client Components.

/**
 * Root error boundary (F226).
 *
 * Catches errors thrown while rendering the root layout or any segment that
 * has no closer `error.tsx` — the class of client render errors that neither
 * `onRequestError` (server only) nor the `window` listeners in
 * `instrumentation-client.ts` (React swallows render errors into boundaries)
 * would otherwise capture.
 *
 * It does two jobs: report the error to the logger, and show the user a clear,
 * self-contained fallback instead of a blank page. Because it replaces the root
 * layout, it must render its own `<html>`/`<body>` and cannot rely on the app's
 * global stylesheet loading — so the fallback is styled inline.
 */

import { useEffect } from "react";
import { reportError } from "@/lib/error-logging";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // The report is scrubbed before it leaves the process. `digest` ties this
    // client event to the matching server-side log entry.
    void reportError(error, {
      context: {
        source: "global-error",
        digest: error.digest,
        url: typeof window !== "undefined" ? window.location.pathname : undefined,
      },
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <main
          style={{
            maxWidth: "28rem",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 1.5rem", color: "#475569", lineHeight: 1.5 }}>
            An unexpected error interrupted this page. The problem has been logged
            and the team will look into it. You can try again.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              padding: "0.625rem 1.25rem",
              fontSize: "0.9375rem",
              fontWeight: 500,
              color: "#ffffff",
              background: "#0f172a",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ margin: "1.5rem 0 0", fontSize: "0.75rem", color: "#94a3b8" }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
