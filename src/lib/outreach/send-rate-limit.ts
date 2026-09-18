export type EmailSendLimit = { maximum: number; windowSeconds: number };

export function resolveEmailSendLimit(source: Record<string, string | undefined> = process.env): EmailSendLimit {
  const maximum = Number(source.EMAIL_SEND_RATE_LIMIT ?? 100);
  const windowSeconds = Number(source.EMAIL_SEND_RATE_WINDOW_SECONDS ?? 3600);
  return {
    maximum: Number.isInteger(maximum) && maximum > 0 ? maximum : 100,
    windowSeconds: Number.isInteger(windowSeconds) && windowSeconds > 0 ? windowSeconds : 3600,
  };
}

export function emailLimitMessage(windowSeconds: number): string {
  return `The outreach sending limit has been reached. Try again in up to ${Math.max(1, Math.ceil(windowSeconds / 60))} minutes.`;
}

export function emailSendWindowStart(windowSeconds: number, now = Date.now()): string {
  return new Date(now - windowSeconds * 1000).toISOString();
}

/**
 * F228: true once a sender's window usage reaches the warn-before-block
 * threshold (80% of the limit, rounded up so small limits still get a
 * warning step — e.g. limit 7 warns from the 6th email). The same scope the
 * F227 enforcement counts: one sender's sends, not the branch total.
 */
export function isNearSendLimit(sentInWindow: number, maximum: number): boolean {
  return sentInWindow >= Math.ceil(maximum * 0.8);
}
