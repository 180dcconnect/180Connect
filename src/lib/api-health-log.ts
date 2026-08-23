type Details = Record<string, string | number | boolean | undefined>;

/**
 * Records the outcome of an outbound call to a third-party API (API_HEALTH_LOGS).
 *
 * Stand-in until the API_HEALTH_LOGS table lands — same shape and same reason as
 * `logAuthApiHealth` (src/lib/auth/observability.ts), generalised so callers outside
 * auth (F082's Gemini calls, and later F100's) don't need their own copy. Swap the
 * body once the approved schema exists; no caller has to change.
 *
 * Never pass raw request/response payloads here: operation names, status, and
 * durations only.
 */
export function logApiHealth(
  service: string,
  operation: string,
  ok: boolean,
  startedAt: number,
  details: Details = {},
) {
  console.info("API_HEALTH_LOGS", {
    service,
    operation,
    ok,
    duration_ms: Date.now() - startedAt,
    ...details,
  });
}
