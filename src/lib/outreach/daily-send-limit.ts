// F128: DEFAULT_OUTREACH_DAILY_SEND_LIMIT and dailySendWindowStart are display-
// only helpers now (the settings sending-limits page's "today's volume" reading).
// Enforcement itself lives entirely in claim_outreach_send / claim_scheduled_
// outreach_send (20261004150000) — a two-step "resolve the limit, then check
// the count" in application code is exactly the race PR #516's review found,
// so there is deliberately no app-side resolver here to enforce with.
export const DEFAULT_OUTREACH_DAILY_SEND_LIMIT = 250;

/**
 * "Daily" means the UK calendar day (Europe/London timezone): the cap resets
 * at midnight UK time, which is midnight in winter (GMT = UTC) and 01:00 UTC
 * in summer (BST = UTC+1). The database RPCs use the same boundary
 * (20261004150000_daily_send_limit_uk_time).
 *
 * Node does not expose IANA timezone arithmetic natively in a single call the
 * way Postgres does, so we derive the UK midnight via Intl.DateTimeFormat: ask
 * the formatter for the date parts in Europe/London, then build a UTC instant
 * from those parts. This is the same technique used by date-fns-tz and Temporal
 * and requires no third-party dependency.
 */
export function dailySendWindowStart(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  // Construct midnight UK time as a UTC instant.
  // Date.UTC treats its arguments as UTC, so we pass the Europe/London date
  // components at 00:00:00 and then subtract the offset that Europe/London has
  // at that moment. Doing this via two Date constructions is safe: Postgres
  // is the source of truth for enforcement; this only drives the display counter.
  const ukMidnight = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));

  // The offset at UK midnight itself (positive = ahead of UTC, e.g. BST = +60 min).
  // We need to find the UTC equivalent of 00:00 Europe/London, which requires
  // knowing the offset AT that local midnight. We bisect: start with the naive
  // UTC midnight, compute its UK offset, shift, recompute. One iteration is
  // sufficient for the ±1h range the UK ever uses.
  const offsetMs = ukTimezoneOffsetMs(ukMidnight);
  const ukMidnightUtc = new Date(ukMidnight.getTime() - offsetMs);

  return ukMidnightUtc.toISOString();
}

/**
 * Returns the offset of Europe/London at `date` in milliseconds
 * (positive = ahead of UTC).
 */
function ukTimezoneOffsetMs(date: Date): number {
  // Format the same instant in UTC and in Europe/London, then diff.
  const utcStr = date.toLocaleString("en-GB", { timeZone: "UTC" });
  const ukStr = date.toLocaleString("en-GB", { timeZone: "Europe/London" });

  const toMs = (s: string) => {
    // "dd/mm/yyyy, hh:mm:ss"
    const [datePart, timePart] = s.split(", ");
    const [d, m, y] = (datePart ?? "").split("/").map(Number);
    const [h, min, sec] = (timePart ?? "").split(":").map(Number);
    return Date.UTC(y!, m! - 1, d!, h!, min!, sec!);
  };

  return toMs(ukStr) - toMs(utcStr);
}

export function dailySendLimitMessage(): string {
  return "The branch's daily outreach sending limit has been reached. Try again after midnight UK time, or ask an admin to raise the limit.";
}
