/**
 * Per-account login throttling (F227), the control the F003 CAPTCHA does not provide.
 *
 * Turnstile prices a scripted flood; it does nothing about a patient attacker
 * working through one account's likely passwords, because each attempt carries a
 * freshly solved token. Supabase's own limits are per-IP, which is the wrong axis
 * for a targeted guess and no use at all against a distributed one. So failures
 * are counted per submitted address, and past a free allowance each one costs
 * wall-clock time.
 *
 * The counting lives in Postgres (`supabase/migrations/20260730010000_create_login_attempt.sql`)
 * because it has to be atomic and survive both deploys and multiple instances —
 * an in-process Map gives an attacker one allowance per warm function instance.
 * This module is the thin app-side half: it maps the RPCs onto a small interface
 * that `attemptLogin` can be handed a fake of.
 */

import { logSecurityEvent } from "../log-security-event.ts";

/** What `attemptLogin` needs from a throttle. Faked wholesale in tests. */
export type LoginThrottle = {
  /** When this address may next attempt a login, or null if it may now. */
  blockedUntil: (email: string) => Promise<Date | null>;
  /** Counts one failed attempt. Returns the block it earned, if any. */
  recordFailure: (email: string) => Promise<Date | null>;
  /** Forgets an address's failures after it signs in. */
  clear: (email: string) => Promise<void>;
};

/**
 * The slice of a Supabase client the throttle uses — enough to fake, and narrow
 * enough that it cannot accidentally be handed something that reads user rows.
 */
export type ThrottleRpcClient = {
  // `PromiseLike`, not `Promise`: supabase-js returns a PostgrestFilterBuilder,
  // which is thenable but has no `catch`/`finally`. Awaiting it is all this needs.
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Used when no service-role key is configured, so the app still runs on a
 * machine that has not set one.
 *
 * This fails **open**, which deserves saying out loud: with no throttle, login
 * falls back to the CAPTCHA plus Supabase's per-IP limits — weaker, but the same
 * position the app was in before this module existed. Failing closed would mean
 * a missing environment variable locks every user out of a working deployment,
 * which is a worse outage than the risk it would avoid. Staging and production
 * must set `SUPABASE_SERVICE_ROLE_KEY`; `src/lib/env.ts` documents that.
 */
export const NO_THROTTLE: LoginThrottle = {
  blockedUntil: async () => null,
  recordFailure: async () => null,
  clear: async () => {},
};

/** Turns an RPC result into a Date, tolerating the null the RPCs return freely. */
function toDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createLoginThrottle(client: ThrottleRpcClient): LoginThrottle {
  /**
   * Every path swallows its error and reports "not throttled". A throttle that
   * refuses logins when its own storage is unreachable converts a database blip
   * into a total outage of sign-in; the CAPTCHA is still in front of the form.
   * The failure is logged so it does not pass unnoticed.
   */
  async function call(name: string, email: string): Promise<Date | null> {
    try {
      const { data, error } = await client.rpc(name, { p_email: email });
      if (error) {
        logSecurityEvent("authentication.login_throttle_unavailable", {
          rpc: name,
          cause: error.message,
        });
        return null;
      }
      return toDate(data);
    } catch (error) {
      logSecurityEvent("authentication.login_throttle_unavailable", {
        rpc: name,
        cause: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  return {
    blockedUntil: (email) => call("login_throttle_state", email),
    recordFailure: (email) => call("record_login_failure", email),
    clear: async (email) => {
      await call("clear_login_failures", email);
    },
  };
}

/**
 * How long to say is left, rounded up and in whole units.
 *
 * Rounded up so the message never invites a retry that is still too early, and
 * coarse because the exact second is noise to the reader — and, marginally, one
 * less detail handed to someone timing the endpoint.
 */
export function describeWait(blockedUntil: Date, now: Date = new Date()): string {
  const seconds = Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * The message shown to a throttled visitor.
 *
 * Says nothing about whether the account exists, and does not need to: the
 * counter is keyed on the submitted string and never consults a user table, so
 * an unknown address is counted and blocked exactly like a real one. The wording
 * is therefore identical in both cases and cannot be used to enumerate accounts.
 */
export function throttleMessage(blockedUntil: Date, now: Date = new Date()): string {
  return `Too many failed login attempts. Try again in ${describeWait(blockedUntil, now)}.`;
}
