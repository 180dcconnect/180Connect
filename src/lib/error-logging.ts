/**
 * Application error logging (F226).
 *
 * Unhandled errors are captured and sent to an error-tracking sink so bugs can
 * be diagnosed after the fact. The sink is Sentry when `NEXT_PUBLIC_SENTRY_DSN`
 * is configured, and structured `console.error` output otherwise — which the
 * hosting platform (Vercel) captures in its logs. Either way an error always
 * produces a durable, structured record in both staging and production.
 *
 * Two hard rules shape this module:
 *
 *   1. It never throws. A logger that can crash the request it is trying to
 *      report is worse than no logger. Every dispatch path is wrapped, and a
 *      transport failure degrades to `console.error`, never to an exception.
 *
 *   2. It never logs sensitive data. Reports pass through `scrub()` before they
 *      leave the process, so passwords, tokens, API keys, auth cookies and
 *      client PII cannot end up in the log content itself (F226 AC3).
 *
 * This file is isomorphic — it runs on both the server (via `onRequestError`
 * and the unhandled-rejection handler in `instrumentation.ts`) and the browser
 * (via `instrumentation-client.ts`). It relies only on `fetch` and
 * `crypto.randomUUID`, which exist in both runtimes.
 */

/** The placeholder written in place of any value we refuse to log. */
export const REDACTED = "[redacted]";

/** How deep into nested objects `scrub` will walk before truncating. */
const MAX_DEPTH = 6;

/** Longest string we keep verbatim; anything longer is truncated. */
const MAX_STRING_LENGTH = 2048;

/**
 * Property names whose values must never be logged, matched case-insensitively
 * against each key. Deliberately broad: a false positive redacts a harmless
 * field, a false negative leaks a credential — the costs are not symmetric.
 */
export const SENSITIVE_KEY_PATTERN =
  /pass(word|wd)?|secret|token|api[-_ ]?key|apikey|authorization|auth|cookie|session|credential|priv(ate)?[-_ ]?key|service[-_ ]?role|bearer|otp|ssn|card|cvv|pin/i;

/**
 * Value patterns that look like secrets even when the key is innocent — a JWT
 * or bearer token pasted into a free-text `message`, for example. Applied to
 * string values that survived the key check.
 */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[\w.\-]+/gi, // Authorization: Bearer <token>
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWTs (header.payload.signature)
  /\b(sk|pk|rk)_[A-Za-z0-9]{10,}/g, // Stripe-style / prefixed secret keys
  /\bsbp_[A-Za-z0-9]{20,}/g, // Supabase service tokens
];

/** Masks an email so a domain can still be seen but the person cannot. */
function maskEmail(value: string): string {
  return value.replace(
    /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    (_match, first: string, domain: string) => `${first}***${domain}`,
  );
}

/** Redacts secret-looking substrings inside an otherwise-loggable string. */
function redactSecretsInString(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return maskEmail(out);
}

/**
 * Returns a deep copy of `value` that is safe to log.
 *
 * - Values under a key matching {@link SENSITIVE_KEY_PATTERN} become `[redacted]`.
 * - Secret-looking substrings and email addresses in string values are masked.
 * - Nesting is capped at {@link MAX_DEPTH} and strings at {@link MAX_STRING_LENGTH}.
 * - Circular references are broken with a `[circular]` marker.
 *
 * The input is never mutated.
 */
export function scrub(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === "string") {
    const masked = redactSecretsInString(value);
    return masked.length > MAX_STRING_LENGTH
      ? `${masked.slice(0, MAX_STRING_LENGTH)}… [truncated]`
      : masked;
  }

  if (value === null || typeof value !== "object") {
    // number, boolean, bigint, undefined, symbol, function → nothing to leak.
    return typeof value === "function" ? "[function]" : value;
  }

  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, seen, depth + 1));
  }

  // Error instances lose their properties under a plain spread, so pull the
  // useful ones out explicitly before scrubbing.
  if (value instanceof Error) {
    return scrub(
      { name: value.name, message: value.message, stack: value.stack },
      seen,
      depth + 1,
    );
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : scrub(item, seen, depth + 1);
  }
  return out;
}

/** The request information attached to a server-side error, if any. */
export type ErrorRequest = {
  path?: string;
  method?: string;
  // Matches Next's `onRequestError` header dictionary, whose values are
  // optional. Sensitive headers (cookie, authorization) are stripped by `scrub`.
  headers?: Record<string, string | string[] | undefined>;
};

/** Free-form context describing where and how the error occurred. */
export type ErrorContext = Record<string, unknown> & {
  request?: ErrorRequest;
};

/** A structured, already-scrubbed error record ready to be dispatched. */
export type ErrorReport = {
  eventId: string;
  timestamp: string;
  level: "error";
  environment: string;
  release?: string;
  platform: "node" | "javascript";
  name: string;
  message: string;
  stack?: string;
  request?: ErrorRequest;
  context: Record<string, unknown>;
};

/** Resolved sink configuration, derived from the environment. */
export type LoggingConfig = {
  /** Sentry DSN, or `undefined` to fall back to console logging. */
  dsn?: string;
  /** Environment tag — `staging`, `production`, `development`. */
  environment: string;
  /** Optional release identifier (git SHA on Vercel). */
  release?: string;
  /** `"node"` on the server, `"javascript"` in the browser. */
  platform: "node" | "javascript";
};

/**
 * Reads the sink configuration from the environment.
 *
 * `NEXT_PUBLIC_SENTRY_DSN` is read with static property access because Next.js
 * inlines `NEXT_PUBLIC_*` values into the client bundle by textual substitution
 * — a dynamic `process.env[name]` lookup would not be replaced (see the note in
 * `env.ts`). A Sentry DSN is safe to expose to the browser by design.
 *
 * The environment tag prefers an explicit `SENTRY_ENVIRONMENT`, then Vercel's
 * built-in `VERCEL_ENV` (`production` | `preview` | `development`), so staging
 * (preview) and production are distinguished automatically without extra
 * configuration.
 */
export function resolveConfig(): LoggingConfig {
  const isServer = typeof window === "undefined";
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined,
    environment:
      process.env.SENTRY_ENVIRONMENT?.trim() ||
      process.env.NEXT_PUBLIC_VERCEL_ENV?.trim() ||
      process.env.VERCEL_ENV?.trim() ||
      "development",
    release:
      process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim() ||
      undefined,
    platform: isServer ? "node" : "javascript",
  };
}

/**
 * Pulls a readable name and message out of whatever was thrown or returned.
 *
 * Not everything that reaches here is an `Error`. Supabase hands back a
 * `PostgrestError` — a plain object `{ message, details, hint, code }` — and
 * `String()` renders that as "[object Object]", discarding the only part worth
 * reading. That is not hypothetical: the first real `set_user_active` failure
 * logged exactly that and said nothing about the cause.
 *
 * `code`, `hint` and `details` are returned separately so the caller can fold
 * them into the report's context, where `scrub` still sees them.
 */
export function describeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
  fields: Record<string, unknown>;
} {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack, fields: {} };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const key of ["code", "hint", "details"] as const) {
      if (record[key] !== undefined && record[key] !== null) {
        fields[`error${key[0].toUpperCase()}${key.slice(1)}`] = record[key];
      }
    }

    if (typeof record.message === "string" && record.message !== "") {
      return {
        name: typeof record.name === "string" ? record.name : "Error",
        message: record.message,
        fields,
      };
    }

    // No message to salvage. JSON beats "[object Object]" — it at least shows
    // the shape. Falls back if the value is circular or otherwise unserialisable.
    try {
      return { name: "Error", message: JSON.stringify(error), fields };
    } catch {
      return { name: "Error", message: Object.prototype.toString.call(error), fields };
    }
  }

  return { name: "Error", message: String(error), fields: {} };
}

/**
 * Builds a scrubbed {@link ErrorReport} from a caught value and its context.
 * Exported for testing; call {@link reportError} in application code.
 */
export function buildReport(
  error: unknown,
  context: ErrorContext,
  config: LoggingConfig,
): ErrorReport {
  const described = describeError(error);
  const { request, ...rest } = context;

  // The error's own code/hint/details go in alongside the caller's context, and
  // lose to it on a key clash — the call site knows what it was doing.
  const scrubbedContext = scrub({
    ...described.fields,
    ...rest,
  }) as Record<string, unknown>;
  const scrubbedRequest = request
    ? (scrub(request) as ErrorRequest)
    : undefined;

  return {
    eventId: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    level: "error",
    environment: config.environment,
    release: config.release,
    platform: config.platform,
    name: described.name,
    message: scrub(described.message) as string,
    stack: described.stack ? (scrub(described.stack) as string | undefined) : undefined,
    request: scrubbedRequest,
    context: scrubbedContext,
  };
}

/** A Sentry DSN broken into the parts needed to build the ingest URL. */
export type ParsedDsn = {
  envelopeUrl: string;
  publicKey: string;
  projectId: string;
};

/**
 * Parses a Sentry DSN of the form
 * `https://<publicKey>@<host>/<projectId>` into its envelope-ingest URL.
 * Returns `null` for anything that is not a well-formed DSN.
 */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) return null;
    const envelopeUrl =
      `${url.protocol}//${url.host}/api/${projectId}/envelope/` +
      `?sentry_key=${publicKey}&sentry_version=7`;
    return { envelopeUrl, publicKey, projectId };
  } catch {
    return null;
  }
}

/**
 * Serialises a report into a Sentry envelope (three newline-delimited JSON
 * objects: envelope header, item header, event payload).
 */
export function buildSentryEnvelope(report: ErrorReport, dsn: string): string {
  const header = JSON.stringify({
    event_id: report.eventId,
    sent_at: new Date().toISOString(),
    dsn,
  });
  const itemHeader = JSON.stringify({
    type: "event",
    content_type: "application/json",
  });
  const payload = JSON.stringify({
    event_id: report.eventId,
    timestamp: report.timestamp,
    platform: report.platform,
    level: report.level,
    environment: report.environment,
    release: report.release,
    exception: {
      values: [
        {
          type: report.name,
          value: report.message,
          // The stack is kept as raw text rather than parsed frames: it is
          // enough to diagnose an issue, and frame parsing is brittle across
          // runtimes. Sentry still displays it under the event.
          stacktrace: report.stack ? { frames: [], raw: report.stack } : undefined,
        },
      ],
    },
    request: report.request
      ? {
          url: report.request.path,
          method: report.request.method,
          headers: report.request.headers,
        }
      : undefined,
    extra: { ...report.context, stacktrace: report.stack },
  });
  return `${header}\n${itemHeader}\n${payload}\n`;
}

/** Writes the report to stdout/stderr in a single structured line. */
function logToConsole(report: ErrorReport): void {
  // One JSON line so log processors (and Vercel's log drains) can parse it.
  console.error(`[error-logging] ${JSON.stringify(report)}`);
}

/**
 * Captures an error: builds a scrubbed report, always writes it to the console
 * (so it is durable in the platform logs of every environment), and, when a
 * Sentry DSN is configured, also ships it to Sentry.
 *
 * Never throws. A transport failure is itself logged and swallowed.
 */
export async function reportError(
  error: unknown,
  context: ErrorContext = {},
): Promise<void> {
  let report: ErrorReport;
  try {
    report = buildReport(error, context, resolveConfig());
  } catch (buildError) {
    // Even building the report failed — fall back to the crudest safe log.
    console.error("[error-logging] failed to build report", buildError);
    return;
  }

  logToConsole(report);

  const dsn = resolveConfig().dsn;
  if (!dsn) return;

  const parsed = parseDsn(dsn);
  if (!parsed) {
    console.error("[error-logging] NEXT_PUBLIC_SENTRY_DSN is not a valid DSN");
    return;
  }

  try {
    await fetch(parsed.envelopeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: buildSentryEnvelope(report, dsn),
      // Never let a slow Sentry keep a request or the process hanging.
      keepalive: true,
    });
  } catch (transportError) {
    console.error("[error-logging] failed to send to Sentry", transportError);
  }
}
