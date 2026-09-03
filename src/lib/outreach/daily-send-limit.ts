// F128: DEFAULT_OUTREACH_DAILY_SEND_LIMIT and dailySendWindowStart are display-
// only helpers now (the admin sending-limits page's "today's volume" reading).
// Enforcement itself lives entirely in claim_outreach_send / claim_scheduled_
// outreach_send (20260912180100) — a two-step "resolve the limit, then check
// the count" in application code is exactly the race PR #516's review found,
// so there is deliberately no app-side resolver here to enforce with.
export const DEFAULT_OUTREACH_DAILY_SEND_LIMIT = 250;

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
