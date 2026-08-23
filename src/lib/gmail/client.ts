import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";
import { createGmailMime, encodeGmailRaw, type GmailMimeMessage } from "./mime.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 15_000;

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

async function accessToken(config: GmailConfig): Promise<string> {
  const startedAt = Date.now();
  const response = await fetch(TOKEN_ENDPOINT, {
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
  if (!response.ok || !body?.access_token) throw new Error(`Gmail OAuth refresh failed (${response.status}).`);
  return body.access_token;
}

/** F241 transport. It never returns provider response bodies or credentials to the UI. */
export async function sendGmailMessage(
  message: GmailMimeMessage,
  options: { threadId?: string; config?: GmailConfig; fetchImpl?: typeof fetch } = {},
): Promise<GmailSendResult> {
  const config = options.config ?? resolveGmailConfig();
  if (!config) return { ok: false, retryable: false, reason: "Gmail is not configured." };
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = Date.now();
  try {
    const token = options.fetchImpl ? "test-access-token" : await accessToken(config);
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
        retryable: response.status === 429 || response.status >= 500,
        reason: response.status === 401 || response.status === 403
          ? "The Gmail connection needs to be re-authorised."
          : "Gmail could not send the email. Try again.",
      };
    }
    return { ok: true, providerMessageId: body.id, providerThreadId: body.threadId };
  } catch (error) {
    logApiHealth("gmail", "users.messages.send", false, startedAt);
    await reportError(error, { scope: "gmail.send" });
    return { ok: false, retryable: true, reason: "Gmail is temporarily unavailable. Try again." };
  }
}
