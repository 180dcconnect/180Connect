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

/** F134: the reply fields needed to rebuild a client's conversation. */
export type ThreadReplyRow = {
  id: string;
  outreach_message_id: string | null;
  reply_body: string;
  received_at: string;
};

export type EmailThreadEntry = {
  id: string;
  kind: "outgoing" | "incoming";
  body: string;
  occurredAt: string;
  subject: string | null;
  senderName: string | null;
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

/**
 * F134: merges every delivered outreach email and linked client reply into one
 * oldest-first conversation. Replies retain their original message subject when
 * that message still exists; the reply itself remains visible if it does not.
 */
export function buildEmailThread(
  sentMessages: readonly OutreachMessageRow[],
  replies: readonly ThreadReplyRow[],
): EmailThreadEntry[] {
  const subjectsByMessage = new Map(sentMessages.map((message) => [message.id, message.subject]));
  const entries: EmailThreadEntry[] = [
    ...sentMessages.flatMap((message) =>
      message.sent_at
        ? [{
            id: message.id,
            kind: "outgoing" as const,
            body: message.body,
            occurredAt: message.sent_at,
            subject: message.subject,
            senderName: message.sender?.full_name?.trim() || null,
          }]
        : [],
    ),
    ...replies.map((reply) => ({
      id: reply.id,
      kind: "incoming" as const,
      body: reply.reply_body,
      occurredAt: reply.received_at,
      subject: reply.outreach_message_id
        ? subjectsByMessage.get(reply.outreach_message_id) ?? null
        : null,
      senderName: null,
    })),
  ];

  return entries.sort((a, b) =>
    a.occurredAt === b.occurredAt
      ? a.id.localeCompare(b.id)
      : a.occurredAt.localeCompare(b.occurredAt),
  );
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

/**
 * F130 AC3 — what the history can be narrowed to: one concrete delivery
 * status, or everything. `"all"` is its own value rather than null so call
 * sites never branch on absence.
 */
export type StatusFilter = SendStatus | "all";

export const STATUS_FILTERS: readonly StatusFilter[] = [
  "all",
  "draft",
  "scheduled",
  "sent",
  "failed",
];

export function describeStatusFilter(filter: StatusFilter): string {
  return filter === "all" ? "All" : describeSendStatus(filter);
}

/**
 * F130 AC3: narrows both halves of an already-split history to one status.
 * Filtering the split structure (rather than pre-filtering the raw rows)
 * keeps AC1/AC3's guarantee intact whatever the selection — a filtered view
 * is always a subset of the same sent/not-sent grouping, never a re-sorting
 * that could smuggle a draft into "sent".
 */
export function filterOutreachHistory(
  history: OutreachHistory,
  filter: StatusFilter,
): OutreachHistory {
  if (filter === "all") return history;
  return {
    sent: history.sent.filter((message) => message.send_status === filter),
    notSent: history.notSent.filter((message) => message.send_status === filter),
  };
}
