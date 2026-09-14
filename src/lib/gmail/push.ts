import "server-only";

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { logApiHealth } from "../api-health-log.ts";
import { getGmailAccessToken, resolveGmailConfig, resolveGmailSender } from "./client.ts";

/**
 * Gmail push notifications — how a client's reply reaches the inbox in
 * seconds instead of at the next reply-sync poll.
 *
 * The chain: Gmail `users.watch` publishes to a Cloud Pub/Sub topic whenever
 * the branch mailbox's INBOX changes → a Pub/Sub push subscription POSTs to
 * /api/webhooks/gmail with a Google-signed OIDC token → that route runs the
 * ordinary reply sync over a short recent window (see syncGmailReplies'
 * `sinceMinutes`). The notification carries no message content, only the
 * mailbox address and its new historyId, so nothing here trusts it for more
 * than "look now".
 *
 * Nothing is stored. A history-cursor design would need a new table (Data
 * Model + RLS) to remember the last historyId; re-listing the last few minutes
 * and skipping already-captured ids gets the same result with no schema, and
 * cannot fall out of step with Gmail's history retention.
 *
 * Setup lives in docs/gmail-push-setup.md.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const TIMEOUT_MS = 15_000;

export type GmailPushConfig = {
  /** Full Pub/Sub topic name: projects/<project>/topics/<topic>. */
  topic: string;
  /** The audience configured on the push subscription's OIDC token. */
  audience: string;
  /** The service account the push subscription signs its tokens as. */
  serviceAccount: string;
};

export function resolveGmailPushConfig(
  source: Record<string, string | undefined> = process.env,
): GmailPushConfig | null {
  const topic = source.GMAIL_PUBSUB_TOPIC?.trim();
  const audience = source.GMAIL_PUSH_AUDIENCE?.trim();
  const serviceAccount = source.GMAIL_PUSH_SERVICE_ACCOUNT?.trim().toLowerCase();
  if (!topic || !audience || !serviceAccount) return null;
  if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(topic)) return null;
  return { topic, audience, serviceAccount };
}

let googleKeys: JWTVerifyGetKey | null = null;

/**
 * Proves a push request came from our own Pub/Sub subscription. The route is
 * public (Pub/Sub cannot log in), so this token is the only gate: signed by
 * Google, for our audience, as our service account, with a verified email.
 * A leaked push URL is useless without it.
 */
export async function verifyPushToken(
  authorization: string | null,
  config: Pick<GmailPushConfig, "audience" | "serviceAccount">,
  keys: JWTVerifyGetKey = (googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))),
): Promise<boolean> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: GOOGLE_ISSUERS,
      audience: config.audience,
    });
    return (
      payload.email_verified === true &&
      typeof payload.email === "string" &&
      payload.email.toLowerCase() === config.serviceAccount
    );
  } catch {
    return false;
  }
}

export type GmailPushNotification = { emailAddress: string; historyId: string };

/** Unwraps a Pub/Sub push envelope into Gmail's `{emailAddress, historyId}`. */
export function parsePushNotification(body: unknown): GmailPushNotification | null {
  const data = (body as { message?: { data?: unknown } } | null)?.message?.data;
  if (typeof data !== "string" || data.length === 0) return null;
  try {
    const decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as {
      emailAddress?: unknown;
      historyId?: unknown;
    };
    if (typeof decoded.emailAddress !== "string" || decoded.historyId == null) return null;
    return {
      emailAddress: decoded.emailAddress.trim().toLowerCase(),
      historyId: String(decoded.historyId),
    };
  } catch {
    return null;
  }
}

/**
 * Starts (or renews) the mailbox watch. Gmail expires a watch after 7 days, so
 * this runs on a schedule; calling it again on a live watch simply extends it.
 * INBOX only — our own sends and label changes would otherwise wake the
 * webhook for nothing.
 */
export async function watchGmailInbox(
  topic: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ historyId: string; expiration: string }> {
  const startedAt = Date.now();
  let healthLogged = false;
  try {
    const response = await fetchImpl(`${GMAIL_API}/watch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ topicName: topic, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    logApiHealth("gmail", "users.watch", response.ok, startedAt, { status: response.status });
    healthLogged = true;
    if (!response.ok) throw new Error(`Gmail users.watch failed (${response.status}).`);
    const body = (await response.json()) as { historyId?: unknown; expiration?: unknown };
    return { historyId: String(body.historyId ?? ""), expiration: String(body.expiration ?? "") };
  } catch (error) {
    if (!healthLogged) logApiHealth("gmail", "users.watch", false, startedAt);
    throw error;
  }
}

/** Whether a notification is about the branch outreach mailbox (and not, say, a reused topic). */
export function isBranchMailbox(emailAddress: string): boolean {
  const sender = resolveGmailSender();
  return sender !== null && emailAddress === sender;
}

/**
 * The cron route's whole job, kept here so routes never import the Gmail
 * transport directly (human-send-control.test.ts guards that surface).
 * Returns null when Gmail or push is not configured.
 */
export async function renewGmailWatch(): Promise<{ historyId: string; expiration: string } | null> {
  const gmail = resolveGmailConfig();
  const push = resolveGmailPushConfig();
  if (!gmail || !push) return null;
  return watchGmailInbox(push.topic, await getGmailAccessToken(gmail));
}
