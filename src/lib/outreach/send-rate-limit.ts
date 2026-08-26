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
