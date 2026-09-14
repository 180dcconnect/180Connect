/**
 * Pure logic for the gmail-reply-check Edge Function — no Deno APIs, so the
 * app's node test runner can import it (src/lib/gmail/reply-check-logic.test.ts).
 */

/**
 * How far back each check looks. Four ticks of the 30-second job: wide enough
 * to absorb Gmail's search-index lag and a skipped tick, narrow enough that a
 * non-client email (which is never captured, so always "unseen") re-triggers
 * the Vercel sync at most a handful of times. Anything older is the
 * five-minute gmail_reply_sync sweep's job.
 */
export const WINDOW_SECONDS = 120;

/** The Vercel run only needs a little more than the window above. */
export const SYNC_SINCE_MINUTES = 5;

/** A cached Gmail access token is reused until a minute before it expires. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export type TokenCache = { token: string; expiresAt: number } | null;

export function inboxQuery(nowMs: number, windowSeconds: number = WINDOW_SECONDS): string {
  return `in:inbox after:${Math.floor(nowMs / 1000) - windowSeconds}`;
}

export function usableToken(cache: TokenCache, nowMs: number): string | null {
  return cache && cache.expiresAt - TOKEN_EXPIRY_MARGIN_MS > nowMs ? cache.token : null;
}

export function tokenCacheFrom(body: { access_token?: unknown; expires_in?: unknown }, nowMs: number): TokenCache {
  if (typeof body.access_token !== "string" || body.access_token.length === 0) return null;
  const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  return { token: body.access_token, expiresAt: nowMs + seconds * 1000 };
}

/**
 * PostgREST lookup for listed ids the app already knows about: captured
 * replies, and replies flagged for review (those are resolved by the
 * five-minute sweep, so re-triggering on them every tick would be waste).
 */
export function knownIdsUrl(supabaseUrl: string, ids: readonly string[]): string {
  const url = new URL("/rest/v1/audit_log", supabaseUrl);
  url.searchParams.set("select", "detail->>provider_message_id");
  url.searchParams.set("action", "in.(gmail_reply_captured,gmail_reply_needs_review)");
  url.searchParams.set(
    "detail->>provider_message_id",
    `in.(${ids.map((id) => `"${id.replace(/["\\]/g, "")}"`).join(",")})`,
  );
  return url.toString();
}

export function unseenIds(listed: readonly string[], known: Iterable<string>): string[] {
  const seen = new Set(known);
  return listed.filter((id) => !seen.has(id));
}

/**
 * The Vercel reply-sync URL, built from the base URL pg_cron passes in. Must be
 * https (or localhost for local testing) — the request carries CRON_SECRET.
 */
export function syncUrl(appBaseUrl: unknown, protectionBypass: unknown): string | null {
  if (typeof appBaseUrl !== "string" || appBaseUrl.trim() === "") return null;
  let base: URL;
  try {
    base = new URL(appBaseUrl.trim());
  } catch {
    return null;
  }
  const local = base.hostname === "localhost" || base.hostname === "127.0.0.1";
  if (base.protocol !== "https:" && !(local && base.protocol === "http:")) return null;
  const url = new URL("/api/cron/gmail-replies", base);
  url.searchParams.set("sinceMinutes", String(SYNC_SINCE_MINUTES));
  if (typeof protectionBypass === "string" && protectionBypass.trim() !== "") {
    url.searchParams.set("x-vercel-protection-bypass", protectionBypass.trim());
  }
  return url.toString();
}
