import { logSecurityEvent } from "../log-security-event.ts";

export const DEFAULT_OUTREACH_DAILY_SEND_LIMIT = 250;

/** Resolves to the configured limit, or null if no configuration row exists. */
export type LoadOutreachDailyLimit = () => Promise<number | null>;

/**
 * F128 AC3: the admin-configured cap, read fresh on every send so a change an
 * admin makes takes effect immediately, with no code change or redeploy.
 * Falls back to the default rather than blocking every send outright when the
 * setting itself cannot be read — an outage here must widen to "no cap
 * enforced today" only as a last resort, never to "nothing can be sent".
 * (Unlike a failed count check at the call site, which does fail closed: the
 * difference is a stale-but-safe fallback limit versus not being able to
 * verify volume against a limit at all.)
 *
 * Takes a loader callback rather than a Supabase client, the same shape as
 * checkSuppressionBeforeSend (suppression-check.ts) — keeps this testable
 * without structurally matching the client's generic table-overload type.
 */
export async function resolveOutreachDailyLimit(loadLimit: LoadOutreachDailyLimit): Promise<number> {
  try {
    const limit = await loadLimit();
    if (limit === null) {
      logSecurityEvent("outreach.daily_send_limit_unavailable", { cause: "No configuration row found" });
      return DEFAULT_OUTREACH_DAILY_SEND_LIMIT;
    }
    return limit;
  } catch (error) {
    logSecurityEvent("outreach.daily_send_limit_unavailable", {
      cause: error instanceof Error ? error.message : "Unknown error",
    });
    return DEFAULT_OUTREACH_DAILY_SEND_LIMIT;
  }
}

/**
 * "Daily" means the UTC calendar day: the simplest definition that needs no
 * per-branch timezone configuration (there is only ever the one branch
 * mailbox today), resetting predictably at 00:00 UTC rather than a rolling
 * 24-hour window that never fully resets.
 */
export function dailySendWindowStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function dailySendLimitMessage(): string {
  return "The branch's daily outreach sending limit has been reached. Try again after midnight UTC, or ask an admin to raise the limit.";
}
