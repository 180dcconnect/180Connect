/**
 * Client-side error capture (F226).
 *
 * Runs after the HTML loads but before React hydration, so it is in place to
 * catch the earliest browser errors. Uncaught exceptions and unhandled promise
 * rejections are forwarded to the same scrubbing logger the server uses, which
 * ships them to Sentry when `NEXT_PUBLIC_SENTRY_DSN` is configured and logs
 * them to the console otherwise.
 *
 * Kept intentionally light — Next.js warns if client instrumentation takes
 * longer than 16ms — and wrapped so a reporting failure can never break the
 * page it is trying to observe.
 */
import { reportError } from "@/lib/error-logging";

try {
  window.addEventListener("error", (event) => {
    void reportError(event.error ?? event.message, {
      context: { source: "window.error", url: window.location.pathname },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void reportError(event.reason, {
      context: { source: "unhandledrejection", url: window.location.pathname },
    });
  });
} catch {
  // Never let instrumentation setup break the application.
}
