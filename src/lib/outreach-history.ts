/**
 * F070 — outreach-history section logic behind the client detail page, kept out
 * of the route so it can be tested without a database (same split as
 * @/lib/client-basic-info). Splits a client's outreach_messages rows into "sent"
 * and "not sent" (draft/scheduled/failed) — AC3's whole point is that a CAM must
 * never mistake one for the other, so that distinction is drawn here, not left
 * to the JSX to get right.
 */

export type SendStatus = "draft" | "scheduled" | "sent" | "failed";

export type OutreachMessageRow = {
  id: string;
  subject: string;
  body: string;
  send_status: SendStatus;
  sent_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  /** F125: who actually sent it. Only meaningful on sent rows; optional so
   * existing call sites and tests that don't join the sender still typecheck. */
  sender?: { full_name: string | null } | null;
};

export type OutreachHistory = {
  /** Actually delivered — the record a CAM checks before writing something new. */
  sent: OutreachMessageRow[];
  /** Draft, scheduled, or failed — anything the client has not received. */
  notSent: OutreachMessageRow[];
};

/** Newest first; a missing date sorts last rather than throwing off the order. */
function compareDatesDesc(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : a > b ? -1 : 0;
}

/**
 * Groups and orders a client's outreach messages (F070 AC1, AC3).
 *
 * "Sent" is ordered by when it actually reached the client (`sent_at`) — a
 * message drafted days before it went out still ranks by delivery, not by when
 * someone started writing it, since the point of this list is knowing what the
 * client has actually seen and when. "Not sent" has no `sent_at`, so it orders
 * by `created_at` instead.
 */
export function splitOutreachHistory(
  rows: readonly OutreachMessageRow[],
): OutreachHistory {
  const sent = rows
    .filter((row) => row.send_status === "sent")
    .sort((a, b) => compareDatesDesc(a.sent_at, b.sent_at));

  const notSent = rows
    .filter((row) => row.send_status !== "sent")
    .sort((a, b) => compareDatesDesc(a.created_at, b.created_at));

  return { sent, notSent };
}

const NOT_SENT_LABEL: Record<Exclude<SendStatus, "sent">, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  failed: "Failed to send",
};

/** Label for a message's status badge. */
export function describeSendStatus(status: SendStatus): string {
  return status === "sent" ? "Sent" : NOT_SENT_LABEL[status];
}
