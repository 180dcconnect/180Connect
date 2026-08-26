import "server-only";

import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";
import { createGmailMime, encodeGmailRaw, type GmailMimeMessage } from "./mime.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 15_000;

const REAUTH_REASON = "The Gmail connection needs to be re-authorised.";
const UNAVAILABLE_REASON = "Gmail is temporarily unavailable. Try again.";

export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export function resolveGmailSender(
  source: Record<string, string | undefined> = process.env,
): string | null {
  return source.GMAIL_SENDER_EMAIL?.trim().toLowerCase() || null;
}

export type GmailSendResult =
  | { ok: true; providerMessageId: string; providerThreadId: string }
  | { ok: false; reason: string; retryable: boolean };

export function resolveGmailConfig(
  source: Record<string, string | undefined> = process.env,
): GmailConfig | null {
  const clientId = source.GMAIL_CLIENT_ID?.trim();
  const clientSecret = source.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = source.GMAIL_REFRESH_TOKEN?.trim();
  return clientId && clientSecret && refreshToken
    ? { clientId, clientSecret, refreshToken }
    : null;
}

/**
 * Raised when the refresh-token exchange itself fails. `status` carries the
 * token endpoint's HTTP status (null when the exchange failed below HTTP —
 * a timeout or connection error), so callers can tell a revoked credential
 * (400/401/403 — never worth retrying) from a transient Google-side outage.
 */
export class GmailAuthError extends Error {
  status: number | null;

  constructor(status: number | null, message: string) {
    super(message);
    this.name = "GmailAuthError";
    this.status = status;
  }
}

function isCredentialRejection(status: number | null): boolean {
  return status === 400 || status === 401 || status === 403;
}

export async function getGmailAccessToken(
  config: GmailConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const startedAt = Date.now();
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string } | null;
  logApiHealth("gmail", "oauth.refresh", response.ok, startedAt, { status: response.status });
  if (!response.ok || !body?.access_token) {
    throw new GmailAuthError(response.status, `Gmail OAuth refresh failed (${response.status}).`);
  }
  return body.access_token;
}

/** Pulls the bare address out of either `"Name <addr>"` or a plain address. */
function emailAddressOf(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

/** F241 transport. It never returns provider response bodies or credentials to the UI. */
export async function sendGmailMessage(
  message: GmailMimeMessage,
  options: {
    threadId?: string;
    config?: GmailConfig;
    fetchImpl?: typeof fetch;
    /** Test seam. Injecting a token provider keeps production's OAuth path keyed
     * to real behaviour instead of branching off test-only fields. */
    tokenProvider?: () => Promise<string>;
  } = {},
): Promise<GmailSendResult> {
  const config = options.config ?? resolveGmailConfig();
  if (!config) return { ok: false, retryable: false, reason: "Gmail is not configured." };

  // F223 defence-in-depth: when deployment names the branch mailbox, nothing may
  // send as any other identity — not even code that passes a hand-built `from`.
  // Unset (local dev without sender config) skips the check; the F124 wiring
  // blocks that case before reaching this layer.
  const expectedSender = resolveGmailSender();
  if (expectedSender && emailAddressOf(message.from) !== expectedSender) {
    return {
      ok: false,
      retryable: false,
      reason: "The email was not sent because its sender does not match the branch outreach mailbox.",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenProvider = options.tokenProvider ?? (() => getGmailAccessToken(config, fetchImpl));

  // Auth runs in its own phase: a rejected refresh token is a credential problem
  // ("re-authorise", never retry), not a send outage — and accessToken already
  // logs it under oauth.refresh, so no second health entry must land under
  // users.messages.send for the same failure.
  let token: string;
  try {
    token = await tokenProvider();
  } catch (error) {
    const reauth = error instanceof GmailAuthError && isCredentialRejection(error.status);
    await reportError(error, { scope: "gmail.auth", ...(error instanceof GmailAuthError ? { status: error.status } : {}) });
    return { ok: false, retryable: !reauth, reason: reauth ? REAUTH_REASON : UNAVAILABLE_REASON };
  }

  const startedAt = Date.now();
  try {
    const response = await fetchImpl(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        raw: encodeGmailRaw(createGmailMime(message)),
        ...(options.threadId ? { threadId: options.threadId } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; threadId?: string } | null;
    logApiHealth("gmail", "users.messages.send", response.ok, startedAt, { status: response.status });
    if (!response.ok || !body?.id || !body.threadId) {
      await reportError(new Error(`Gmail send failed (${response.status}).`), {
        scope: "gmail.send",
        status: response.status,
      });
      return {
        ok: false,
        // A 2xx with an unparsable body counts as NOT retryable on purpose: the
        // send may actually have succeeded, and retrying risks a duplicate email.
        retryable: response.status === 429 || response.status >= 500,
        reason: response.status === 401 || response.status === 403
          ? REAUTH_REASON
          : "Gmail could not send the email. Try again.",
      };
    }
    return { ok: true, providerMessageId: body.id, providerThreadId: body.threadId };
  } catch (error) {
    logApiHealth("gmail", "users.messages.send", false, startedAt);
    await reportError(error, { scope: "gmail.send" });
    return { ok: false, retryable: true, reason: UNAVAILABLE_REASON };
  }
}
