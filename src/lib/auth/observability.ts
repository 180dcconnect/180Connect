import "server-only";

import { logSecurityEvent, type SecurityEvent } from "../log-security-event.ts";

type Details = Record<string, string | number | boolean | undefined>;

/**
 * Records the outcome of an outbound Supabase Auth call (API_HEALTH_LOGS).
 *
 * Stand-in until the API_HEALTH_LOGS table lands, in the same shape and for the
 * same reason as `logSecurityEvent` — swap the body once the approved schema
 * exists and no caller has to change.
 *
 * Never pass raw values here: operation names, codes and durations only.
 */
export function logAuthApiHealth(
  operation: string,
  ok: boolean,
  startedAt: number,
  details: Details = {},
) {
  console.info("API_HEALTH_LOGS", {
    service: "supabase-auth",
    operation,
    ok,
    duration_ms: Date.now() - startedAt,
    ...details,
  });
}

/**
 * Records an auth failure (ERROR_LOG).
 *
 * Delegates to `logSecurityEvent` rather than writing a second console format,
 * so there is one place to change when ERROR_LOG becomes a table. Only the
 * error *message* is kept — never the token, link or password that produced it.
 */
export function logAuthError(
  event: SecurityEvent,
  error: unknown,
  details: Details = {},
) {
  logSecurityEvent(event, {
    ...details,
    cause: error instanceof Error ? error.message : "Unknown error",
  });
}
