// Pure logic for session inactivity expiry — no Next.js or Supabase
// objects involved, so this is trivial to test directly (see
// session-expiry.test.ts) and matches the codebase's convention of
// keeping decision logic separate from framework plumbing.

// PLACEHOLDER VALUE — F007's ticket has an open question on the actual
// timeout policy ("Session timeout policy"). Using 30 minutes as a
// reasonable default until that decision is made. Flag for review.
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const ACTIVITY_COOKIE_NAME = "last_activity";

/**
 * Decides whether a session should be treated as expired, given the
 * timestamp of the user's last recorded activity.
 *
 * @param lastActivity - epoch ms of last activity, or null if unknown
 * @param now - current epoch ms
 * @param timeoutMs - how long a session may sit idle before expiring
 */
export function isSessionExpired(
  lastActivity: number | null,
  now: number,
  timeoutMs: number = INACTIVITY_TIMEOUT_MS,
): boolean {
  if (lastActivity === null) return false; // no record yet, not expired
  return now - lastActivity > timeoutMs;
}
