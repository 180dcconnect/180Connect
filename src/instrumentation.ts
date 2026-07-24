import type { Instrumentation } from "next";
import { assertEnv } from "@/lib/env";
import { reportError } from "@/lib/error-logging";

/**
 * Runs once per server instance, before any request is handled.
 *
 * Validating here means a missing or malformed environment variable stops the
 * server with a clear message, instead of producing a silent failure or an
 * unexpected error at request time (F231).
 *
 * The Node.js runtime also gets a last-resort handler for promise rejections
 * that escape a request, so background failures are logged rather than lost
 * (F226).
 */
export function register() {
  assertEnv();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.on("unhandledRejection", (reason) => {
      void reportError(reason, { context: { source: "unhandledRejection" } });
    });
  }
}

/**
 * Captures every server error Next.js surfaces — Server Components, Route
 * Handlers, Server Actions and the proxy — with the request and routing
 * context needed to diagnose it (F226). The report is scrubbed before it is
 * logged, so credentials and PII never reach the log content.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  await reportError(err, {
    request: {
      path: request.path,
      method: request.method,
      headers: request.headers,
    },
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
  });
};
