/**
 * Inactivity-based session expiry (F007).
 *
 * A signed-in user who walks away must not leave a usable session behind. The
 * proxy records when it last saw a request from a signed-in browser and ends
 * the session once that record goes stale.
 *
 * The record lives in a cookie rather than a table, so expiry costs no database
 * round trip on every request. That makes it attacker-controlled input, which
 * drives the two rules this module exists to enforce:
 *
 *   1. **Fail closed.** A missing, malformed or unverifiable record means
 *      *expired*, never "fresh". Otherwise dropping one cookie — which a
 *      session replayed in another browser does simply by not having it — would
 *      buy permanent immunity from the timeout. `src/app/login/actions.ts`
 *      writes the first record at sign-in, so a real session always has one.
 *   2. **Signed timestamps.** The record is HMAC-signed with a server-side
 *      secret, so a replayed session cannot mint itself a fresher one. Without
 *      `SESSION_ACTIVITY_SECRET` the app falls back to unsigned records: those
 *      still expire idle sessions, but cannot resist a forged timestamp. That
 *      env var is what makes "cannot be reused even if replayed" hold, and
 *      `src/lib/env.ts` documents it as such.
 *
 * The logic below is pure and framework-free; the proxy owns the cookie I/O.
 */

// Relative, extension-qualified import: this module is unit-tested by
// `node --test`, which resolves neither the `@/` alias nor bare .ts specifiers.
import { signValue, timingSafeEqual } from "../hmac.ts";

/**
 * How long a session may sit idle before it is ended.
 *
 * 30 minutes: long enough to survive a meeting, short enough that an unlocked
 * laptop is not an open door. Change it here — nothing else hardcodes a timeout.
 */
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** Cookie holding the signed "last seen" timestamp. */
export const ACTIVITY_COOKIE_NAME = "last_activity";

/**
 * Tolerance for a record that appears to be in the future. Clocks in different
 * serverless regions can disagree by a little; anything beyond this is not
 * drift, it is a forged timestamp.
 */
const FUTURE_TOLERANCE_MS = 60 * 1000;

/**
 * Decides whether a session should be treated as expired.
 *
 * @param lastActivity - epoch ms of the last verified activity, or null when
 *   there is no usable record. Null expires the session — see rule 1 above.
 * @param now - current epoch ms.
 * @param timeoutMs - how long a session may sit idle.
 */
export function isSessionExpired(
  lastActivity: number | null,
  now: number,
  timeoutMs: number = INACTIVITY_TIMEOUT_MS,
): boolean {
  if (lastActivity === null || !Number.isFinite(lastActivity)) return true;
  // A future timestamp would otherwise postpone expiry indefinitely.
  if (lastActivity > now + FUTURE_TOLERANCE_MS) return true;
  return now - lastActivity >= timeoutMs;
}

/** The secret used to sign activity records, or null when none is configured. */
export function activitySecret(
  source: Record<string, string | undefined> = process.env,
): string | null {
  return source.SESSION_ACTIVITY_SECRET?.trim() || null;
}

/**
 * Builds the cookie value recording activity at `timestamp`.
 *
 * With a secret the value is `<timestamp>.<hmac>`; without one it is the bare
 * timestamp, which `readActivity` still accepts (unsigned mode).
 */
export async function signActivity(
  timestamp: number,
  secret: string | null,
): Promise<string> {
  const value = String(timestamp);
  if (!secret) return value;
  return `${value}.${await signValue(value, secret)}`;
}

/**
 * Reads a cookie value back into a timestamp, or null if it cannot be trusted.
 *
 * Null covers every failure — absent, malformed, wrong signature — and callers
 * treat null as expired, so a tampered cookie is worth no more than none.
 */
export async function readActivity(
  cookieValue: string | undefined,
  secret: string | null,
): Promise<number | null> {
  if (!cookieValue) return null;

  const separator = cookieValue.indexOf(".");
  const timestampPart =
    separator === -1 ? cookieValue : cookieValue.slice(0, separator);
  const signaturePart = separator === -1 ? null : cookieValue.slice(separator + 1);

  if (!/^\d{1,15}$/.test(timestampPart)) return null;
  const timestamp = Number(timestampPart);

  if (!secret) {
    // Unsigned mode: take the timestamp, ignoring any signature left behind by
    // a secret that has since been removed.
    return timestamp;
  }

  if (!signaturePart) return null;
  const expected = await signValue(timestampPart, secret);
  if (!timingSafeEqual(signaturePart, expected)) return null;

  return timestamp;
}

/** Cookie attributes shared by the proxy and the login action. */
export type ActivityCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

/**
 * Attributes for the activity cookie. Shared so the proxy and the login action
 * can never write the same cookie with different scopes — a mismatched `path`
 * would silently produce two cookies and break expiry.
 */
export function activityCookieOptions(): ActivityCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Outliving the window it records would serve no purpose: a record older
    // than the timeout can only ever mean "expired".
    maxAge: Math.floor(INACTIVITY_TIMEOUT_MS / 1000),
  };
}
