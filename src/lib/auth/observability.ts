import "server-only";

type Details = Record<string, string | number | boolean | undefined>;

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

export function logAuthError(event: string, error: unknown, details: Details = {}) {
  console.error("ERROR_LOG", {
    event,
    cause: error instanceof Error ? error.message : "Unknown error",
    ...details,
  });
}

