/**
 * F075/F076 reuse — the Outreach Inbox (/inbox) turns the same four timeline
 * sources the client page merges into a chronological feed into Gmail-style
 * *threads*: one row per organisation, newest activity first.
 *
 * Kept out of the route so it can be tested without a database (same split as
 * @/lib/client-basic-info and @/lib/recent-updates), and built ON TOP of
 * @/lib/timeline.ts's already-tested builders rather than beside them — a
 * thread is just a timeline scoped to one client, so the event vocabulary
 * (labels, tones, phrasing) stays identical across both views.
 *
 * v1 scope decisions (agreed with the team):
 * - Group by ORGANISATION, not Gmail thread: OUTREACH_MESSAGES stores no
 *   gmail_thread_id, and organisation grouping needs zero schema changes.
 * - Read-only: a thread row opens the thread's conversation view
 *   (/inbox/[orgId]); generating/sending happens via the approved send path
 *   (PRD §12.1) from the client page it links to, never from this list.
 * - All roles with client:view see it: RLS already grants SELECT on
 *   outreach_messages/reply_events to every active user (matrix §3.4), and
 *   open-questions.md records that viewers read communication history in full.
 * - Unbounded history: the list fetches all sent messages (paged fetch, same
 *   as the dashboard's fetchAllRows), newest first.
 */

import { formatRelativeTime } from "./display-format.ts";
import {
  buildEmailSentEntry,
  buildReplyReceivedEntry,
  type OutreachMessageRow,
  type ReplyEventRow,
} from "./timeline.ts";

/**
 * Rows the route must supply. The org name travels with each row (rather than
 * a separate map) so the builder stays a pure function over flat arrays — the
 * route joins outreach_messages → organisations anyway, and this is also how
 * suppressed clients fall out: rows whose organisation is missing or filtered
 * simply never reach this builder.
 */
export type InboxMessageRow = OutreachMessageRow & { organisation_id: string };
export type InboxReplyRow = ReplyEventRow & {
  organisation_id: string;
  intent?: string | null;
  /** REPLY_EVENTS.contact_id — lets the view name the person who replied. */
  contact_id?: string | null;
};

/** How a thread row summarises its state at a glance. */
export type InboxThreadStatus = "replied" | "awaiting" | "sent";

/**
 * One inbox row: the latest thing that happened on a client's outreach, plus
 * enough context (counts, intent) to scan the list without opening it.
 */
export type InboxThread = {
  orgId: string;
  orgName: string;
  href: string;
  /** ISO timestamp of the newest event in the thread (sent or reply). */
  lastActivityAt: string;
  /** "Ada Lovelace" or "The client" — same actor vocabulary as the timeline. */
  lastActorName: string;
  /** The event label ("Email sent" / "Reply received") — same map as F076. */
  lastEventLabel: string;
  /** Subject of the newest sent email, or the reply body preview. */
  subject: string;
  /** Plain-text preview, trimmed to SNIPPET_MAX_LENGTH characters. */
  snippet: string;
  status: InboxThreadStatus;
  /** Set when status is "replied": the classified intent of the latest reply. */
  replyIntent: string | null;
  /** How many sent messages + replies make up this thread. */
  messageCount: number;
  relativeTime: string;
  /**
   * A reply from the last 48 hours — what a CAM opened the list to find, so the
   * row reads as unread. Computed here against the caller's `now` rather than
   * in the component, which would re-evaluate it against the browser clock and
   * could disagree with the server's render near the boundary.
   */
  isRecent: boolean;
};

/** Snippets longer than this are truncated (with an ellipsis) in the list. */
export const SNIPPET_MAX_LENGTH = 120;

/**
 * Reply intent tokens as stored in REPLY_EVENTS.intent (data model 07).
 * Exported for tests; the route renders them through a label map in the
 * component, keeping this module free of UI concerns.
 */
export const REPLY_INTENTS = ["interested", "not_interested", "more_info", "referral"] as const;

/** First line of a multi-line body, whitespace-collapsed, length-capped. */
export function snippetFrom(text: string | null | undefined): string {
  const firstLine = (text ?? "").split("\n").find((line) => line.trim().length > 0) ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SNIPPET_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, SNIPPET_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * One entry in a thread's conversation — a sent email or a client reply, in
 * reading order (oldest first). The conversation view renders these directly.
 */
export type ConversationEntry = {
  id: string;
  type: "email_sent" | "reply_received";
  timestamp: string;
  /** "Ada Lovelace" for a send; the contact's name, or "The client", for a reply. */
  actorName: string;
  /** Replies carry no subject of their own. */
  subject: string | null;
  body: string;
  /**
   * Classified intent of a reply (REPLY_EVENTS.intent). Only ever set on
   * `reply_received`; null on sends and on replies never classified.
   */
  intent: string | null;
};

/**
 * One organisation's conversation in reading order (oldest first): every sent
 * email and every client reply, interleaved. Rows for other organisations are
 * ignored, and rows whose organisation has no name in `orgNames` are dropped
 * (suppressed/deleted — same convention as buildInboxThreads).
 */
export function buildConversation(
  messages: readonly (InboxMessageRow & { body?: string | null })[],
  replies: readonly InboxReplyRow[],
  orgId: string,
  orgNames: ReadonlyMap<string, string>,
  /**
   * contacts.id → display name. A reply whose contact resolves is attributed to
   * that person; anything else keeps @/lib/timeline's "The client", so the two
   * views never disagree about how an unknown sender is named.
   */
  contactNames: ReadonlyMap<string, string> = new Map(),
): ConversationEntry[] {
  if (!orgNames.get(orgId)) return [];

  const entries: ConversationEntry[] = [];

  for (const row of messages) {
    if (row.organisation_id !== orgId) continue;
    const entry = buildEmailSentEntry(row);
    if (!entry) continue; // drafts/scheduled are not events (timeline's rule)
    entries.push({
      id: entry.id,
      type: "email_sent",
      timestamp: entry.timestamp,
      actorName: entry.actorName,
      subject: row.subject,
      body: row.body ?? "",
      intent: null,
    });
  }

  for (const row of replies) {
    if (row.organisation_id !== orgId) continue;
    const entry = buildReplyReceivedEntry(row);
    const contactName = row.contact_id ? contactNames.get(row.contact_id) : null;
    entries.push({
      id: entry.id,
      type: "reply_received",
      timestamp: entry.timestamp,
      actorName: contactName?.trim() || entry.actorName,
      subject: null,
      body: row.reply_body,
      intent: row.intent?.trim() || null,
    });
  }

  // Reading order: oldest first, like opening an email thread top-down.
  return entries.sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
}

/**
 * A thread's status from its event stream:
 * - "replied"  — the newest event is a client reply (action needed, most
 *                interesting state, sorts first within equal timestamps).
 * - "awaiting" — the newest event is a sent email and at least one reply
 *                already happened earlier (a follow-up is in flight).
 * - "sent"     — only outreach sent, no reply yet (cold thread).
 */
export function threadStatus(events: ReadonlyArray<{ type: "email_sent" | "reply_received" }>): InboxThreadStatus {
  const newest = events[0];
  if (!newest) return "sent";
  if (newest.type === "reply_received") return "replied";
  return events.some((event) => event.type === "reply_received") ? "awaiting" : "sent";
}

/** True when a reply is fresh enough to deserve the unread-style highlight. */
export function isRecentReply(lastActivityAt: string, now: Date): boolean {
  const time = new Date(lastActivityAt).getTime();
  if (Number.isNaN(time)) return false;
  return now.getTime() - time <= 48 * 60 * 60 * 1000;
}

/**
 * Groups flat message + reply rows into threads, one per organisation,
 * newest-first. Rows whose organisation has no name in `orgNames` are dropped
 * (deleted, or filtered out of the visible set) — the same convention
 * @/lib/recent-updates.ts uses so suppressed clients never surface.
 */
export function buildInboxThreads(
  messages: readonly InboxMessageRow[],
  replies: readonly InboxReplyRow[],
  orgNames: ReadonlyMap<string, string>,
  now: Date = new Date(),
): InboxThread[] {
  /** Intermediate accumulation per org, before final shaping. */
  const threads = new Map<
    string,
    {
      events: Array<{
        type: "email_sent" | "reply_received";
        timestamp: string;
        actorName: string;
        eventLabel: string;
        subject: string;
        snippet: string;
        replyIntent?: string | null;
      }>;
      messageCount: number;
    }
  >();

  for (const row of messages) {
    const orgName = orgNames.get(row.organisation_id);
    if (!orgName) continue;
    const entry = buildEmailSentEntry(row);
    if (!entry) continue; // drafts/scheduled are not events (timeline's rule)

    const bucket = threads.get(row.organisation_id) ?? {
      events: [],
      messageCount: 0,
    };
    bucket.messageCount += 1;
    bucket.events.push({
      type: "email_sent",
      timestamp: entry.timestamp,
      actorName: entry.actorName,
      eventLabel: "Email sent",
      subject: row.subject,
      snippet: snippetFrom(row.subject),
    });
    threads.set(row.organisation_id, bucket);
  }

  for (const row of replies) {
    const orgName = orgNames.get(row.organisation_id);
    if (!orgName) continue;
    const entry = buildReplyReceivedEntry(row);

    const bucket = threads.get(row.organisation_id) ?? {
      events: [],
      messageCount: 0,
    };
    bucket.messageCount += 1;
    bucket.events.push({
      type: "reply_received",
      timestamp: entry.timestamp,
      actorName: entry.actorName,
      eventLabel: "Reply received",
      subject: "Reply from the client",
      snippet: snippetFrom(row.reply_body),
      replyIntent: row.intent ?? null,
    });
    threads.set(row.organisation_id, bucket);
  }

  const built: InboxThread[] = [];
  for (const [orgId, bucket] of threads) {
    bucket.events.sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
    );
    const newest = bucket.events[0];
    if (!newest) continue;
    const orgName = orgNames.get(orgId) ?? "";
    const latestReply = bucket.events.find((e) => e.type === "reply_received");
    const status = threadStatus(bucket.events);
    built.push({
      orgId,
      orgName,
      href: `/inbox/${orgId}`,
      lastActivityAt: newest.timestamp,
      lastActorName: newest.actorName,
      lastEventLabel: newest.eventLabel,
      subject: newest.subject,
      snippet: newest.snippet,
      status,
      replyIntent: latestReply?.replyIntent ?? null,
      messageCount: bucket.messageCount,
      relativeTime: formatRelativeTime(new Date(newest.timestamp), now),
      isRecent: status === "replied" && isRecentReply(newest.timestamp, now),
    });
  }

  // Newest activity first — the inbox order. Stable tiebreak on orgId so the
  // order is deterministic for tests and re-renders.
  return built.sort((a, b) =>
    a.lastActivityAt === b.lastActivityAt
      ? a.orgId.localeCompare(b.orgId)
      : a.lastActivityAt < b.lastActivityAt ? 1 : -1,
  );
}
