/**
 * F485 (#485) — Note Notifications and @Mentions. Pure helpers, no database
 * or browser, so they are unit-testable (same split as @/lib/notifications).
 *
 * Two halves share one producer path (the notes POST route beside the
 * `notes` insert, never a trigger — see that route's header):
 *
 * 1. **Note activity** — a note on a client notifies the client's current
 *    owner (`NOTE_ADDED_TYPE`), unless the author is the owner themselves
 *    (`create_notification` also refuses self-notification; skipping up front
 *    just saves the RPC).
 * 2. **@mention** — the composer offers active users on `@` and posts their
 *    ids as `mentionedUserIds`; each mentioned user gets their own
 *    notification (`NOTE_MENTIONED_TYPE`), even when they do not own the
 *    client. The author is never notified about their own note.
 *
 * No migration: `NOTIFICATIONS.notification_type` is an open token
 * (20260822090000) and `public.create_notification` is the sole write path —
 * it already skips inactive recipients, self-notification and sub-minute
 * duplicates. No mention rows are stored: editing a note (F073) cannot
 * retract a sent notification — acceptable, since notifications are
 * documented as ephemeral signals over a durable AUDIT_LOG trail.
 *
 * Routing on explicit ids (chosen from the autocomplete) rather than
 * free-text `@Name` parsing is deliberate: display names collide, change,
 * and — worst — an email address (`sam@180dc.org`) or a bare `@` would
 * otherwise become a notification. Mention-looking text with no chosen id
 * notifies nobody; the saved note still reads as plain text.
 */

import { isUuid } from "./validation.ts";

/** Owner notification: someone noted on a client you own. */
export const NOTE_ADDED_NOTIFICATION_TYPE = "note_added";

/** Mention notification: someone named you inside a note. */
export const NOTE_MENTIONED_NOTIFICATION_TYPE = "note_mentioned";

/** Most ids a single note may mention — a bound on fan-out, not a product limit. */
export const MAX_MENTIONS_PER_NOTE = 10;

/** How many autocomplete suggestions the composer shows per query. */
export const MENTION_SUGGESTION_LIMIT = 6;

export type MentionCandidate = {
  id: string;
  fullName: string;
};

/**
 * Where the bell sends the recipient: the client's Outreach tab, anchored on
 * the Notes card (`notes-heading` is that card's `headingId`, so the element
 * id exists). Per-note anchors do not exist; the row's `target_table` /
 * `target_id` (`notes` / the note id) carry the exact note for any future
 * deep link. Absolute, so it survives `mapNotificationRows`' guard.
 */
export function noteNotificationLinkPath(organisationId: string): string {
  return `/clients/${organisationId}/outreach#notes-heading`;
}

/**
 * One-line preview for the notification body — same 240-char collapsed shape
 * the reply trigger (`notify_on_reply_event`, 20260912170300) uses, so the
 * bell reads consistently. The body only ever goes to users who can already
 * read the client (all active roles share read), so no content is leaked by
 * including it.
 */
export function summariseNoteContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 240);
}

export function buildOwnerNoteTitle(authorName: string, organisationName: string): string {
  return `${authorName} added a note to ${organisationName}`;
}

export function buildMentionNoteTitle(authorName: string, organisationName: string): string {
  return `${authorName} mentioned you in ${organisationName}`;
}

/**
 * Sanitises the composer's `mentionedUserIds` into the ids that should
 * actually be notified: well-formed uuids, deduped, capped, and never the
 * author. Active-status and read-access checks stay server-side (the pure
 * layer has no database); `create_notification` additionally skips inactive
 * recipients, so this failing open notifies nobody it should not.
 */
export function resolveMentionRecipientIds(
  mentionedUserIds: readonly unknown[],
  authorId: string,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of mentionedUserIds) {
    if (typeof value !== "string" || !isUuid(value)) continue;
    if (value === authorId || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= MAX_MENTIONS_PER_NOTE) break;
  }
  return result;
}

/**
 * Whether the client's owner should be notified about this note: there is an
 * owner, and it is not the author (self-notification is noise — the
 * `create_notification` RPC would skip it anyway; deciding it here keeps the
 * intent visible next to the producer rather than only in the migration).
 * An unowned client notifies nobody and errors nothing.
 */
export function shouldNotifyOwner(ownerId: string | null, authorId: string): boolean {
  return ownerId !== null && ownerId !== "" && ownerId !== authorId;
}

/**
 * When the owner is also @mentioned, the mention carries the signal and the
 * generic owner notification would be a second row about the same note.
 * The mention wins; the owner notification is skipped.
 */
export function ownerAlreadyMentioned(ownerId: string | null, mentionIds: readonly string[]): boolean {
  return ownerId !== null && mentionIds.includes(ownerId);
}

// ─── Composer autocomplete ──────────────────────────────────────────────

/**
 * The `@` query under the cursor, if the cursor is inside a mention trigger.
 * A trigger is an `@` at the start of the field or after whitespace / `(` —
 * so `sam@180dc.org` (preceded by a word char) is never a trigger, while a
 * bare `@` is (empty query = show everyone). The query runs to the cursor
 * and may not contain `@` or a newline.
 */
export function mentionQueryAtCursor(
  value: string,
  cursor: number,
): { query: string; start: number } | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, safeCursor);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/[\s(]/.test(before[at - 1] ?? "")) return null;
  const query = before.slice(at + 1);
  if (query.includes("@") || query.includes("\n")) return null;
  if (!/^[A-Za-z0-9 .'\-]*$/.test(query)) return null;
  return { query, start: at };
}

/** Case-insensitive substring match on display name, capped for the listbox. */
export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const needle = query.trim().toLowerCase();
  const matches = needle === ""
    ? [...candidates]
    : candidates.filter((c) => c.fullName.toLowerCase().includes(needle));
  return matches.slice(0, MENTION_SUGGESTION_LIMIT);
}

/**
 * Splices the chosen candidate into the draft, replacing the `@query` span
 * with `@Full Name ` (trailing space so the author can keep typing), and
 * returns the new caret position.
 */
export function applyMentionInsertion(
  value: string,
  cursor: number,
  candidate: MentionCandidate,
): { value: string; cursor: number } {
  const trigger = mentionQueryAtCursor(value, cursor);
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const insertion = `@${candidate.fullName} `;
  if (!trigger) return { value, cursor: safeCursor };
  const next = value.slice(0, trigger.start) + insertion + value.slice(safeCursor);
  return { value: next, cursor: trigger.start + insertion.length };
}

// ─── Saved-note rendering ───────────────────────────────────────────────

export type NoteContentPart = { text: string; mention: boolean };

/**
 * Splits saved note text so `@Name` tokens can render distinctly while
 * everything else stays plain text. `knownNames` are the display names the
 * composer could have inserted (active users' `full_name`); a token only
 * highlights when the text after `@` starts with one of them (longest match
 * wins, compared case-insensitively but rendered as typed). Anything else —
 * an email address (`sam@180dc.org`, whose `@` follows a word char), a bare
 * `@` with no name, a renamed or deleted user — stays plain text, so the
 * note is always readable even when a mention cannot be resolved.
 */
export function splitNoteContentMentions(
  content: string,
  knownNames: readonly string[],
): NoteContentPart[] {
  const names = knownNames
    .map((n) => n.trim())
    .filter((n) => n !== "")
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text: content, mention: false }];

  const parts: NoteContentPart[] = [];
  let i = 0;
  let plainStart = 0;

  function flushPlain(end: number) {
    if (end > plainStart) parts.push({ text: content.slice(plainStart, end), mention: false });
  }

  while (i < content.length) {
    if (content[i] !== "@" || (i > 0 && !/[\s(]/.test(content[i - 1] ?? ""))) {
      i += 1;
      continue;
    }
    const rest = content.slice(i + 1);
    const hit = names.find((n) => rest.toLowerCase().startsWith(n.toLowerCase()));
    if (!hit) {
      i += 1;
      continue;
    }
    flushPlain(i);
    parts.push({ text: `@${rest.slice(0, hit.length)}`, mention: true });
    i += 1 + hit.length;
    plainStart = i;
  }
  flushPlain(content.length);
  if (parts.length === 0) return [{ text: content, mention: false }];
  return parts;
}

// ─── Mention-to-text binding (F485 review) ─────────────────────────────

/**
 * How many times `@Name` is actually mentioned in `content`. A hit needs the
 * composer's trigger on its left (start of text, whitespace, or `(` — so
 * `sam@180dc.org` never counts) and a word boundary on its right: end of
 * text, whitespace, or punctuation. A mention extended with more word text
 * (`@Sam Lee` typed on into `@Sam Leeds`, or hyphenated into `@Sam Lee-Smith`)
 * stops counting as a mention of `Sam Lee` — but a period or apostrophe does
 * not continue a word, so `@Sam Lee.` and `@Sam Lee's` still mention Sam Lee.
 * Compared case-insensitively: re-casing a name edits its style, not its
 * referent.
 */
export function countMentionOccurrences(content: string, name: string): number {
  const needle = `@${name.trim()}`.toLowerCase();
  if (needle.length <= 1) return 0;
  const hay = content.toLowerCase();
  let count = 0;
  let from = 0;
  while (true) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return count;
    const prev = at === 0 ? "" : (content[at - 1] ?? "");
    const next = content[at + needle.length] ?? "";
    if ((prev === "" || /[\s(]/.test(prev)) && (next === "" || !/[A-Za-z0-9\-]/.test(next))) {
      count += 1;
    }
    from = at + needle.length;
  }
}

/**
 * Binds candidate ids to actual mentions in the saved text: each distinct
 * name survives at most as many times as it is mentioned, in candidate
 * order. Both the composer (whose candidates are its insertions, oldest
 * first) and the API routes (whose candidates are the requested active
 * users) reconcile through this one function, so a crafted `mentionedUserIds`
 * naming users the text never mentions notifies nobody, and a mention the
 * author typed over or deleted takes its id with it.
 *
 * Known limit, documented rather than hidden: two teammates sharing a
 * display name are indistinguishable in plain text, so with one `@Sam Lee`
 * occurrence the first-listed id wins. Counts stay exact; only identity
 * among same-named users can blur.
 */
export function limitMentionIdsByOccurrences(
  content: string,
  candidates: readonly { id: string; name: string }[],
): string[] {
  const remaining = new Map<string, number>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.name.trim().toLowerCase();
    if (key === "") continue;
    let left = remaining.get(key);
    if (left === undefined) {
      left = countMentionOccurrences(content, candidate.name);
      remaining.set(key, left);
    }
    if (left > 0) {
      remaining.set(key, left - 1);
      result.push(candidate.id);
    }
  }
  return result;
}

// ─── Bulk fan-out (F485 on F065) ────────────────────────────────────────

/**
 * A bulk comment is one action across many clients, so per-client
 * notification rows would flood the bell (up to MAX_BULK_NOTE_CLIENTS of
 * them for one click). Owners are therefore grouped: one notification per
 * distinct owner. An owner holding exactly one of the selected clients gets
 * the same shaped payload as the single-note flow (naming that client and
 * linking to its notes); an owner holding several gets one grouped row
 * naming the count and linking to the client list.
 */
export type BulkClientOwner = {
  organisationId: string;
  organisationName: string;
  ownerId: string | null;
};

/** Distinct owner ids holding at least one client, never the author. */
export function groupBulkClientsByOwner(
  clients: readonly BulkClientOwner[],
  authorId: string,
): Map<string, BulkClientOwner[]> {
  const groups = new Map<string, BulkClientOwner[]>();
  for (const client of clients) {
    const ownerId = client.ownerId;
    if (ownerId === null || !shouldNotifyOwner(ownerId, authorId)) continue;
    const group = groups.get(ownerId);
    if (group) group.push(client);
    else groups.set(ownerId, [client]);
  }
  return groups;
}

export function buildBulkOwnerGroupTitle(authorName: string, clientCount: number): string {
  return `${authorName} added a comment to ${clientCount} client${clientCount === 1 ? "" : "s"} you own`;
}

export function buildBulkMentionTitle(authorName: string, clientCount: number): string {
  return clientCount === 1
    ? `${authorName} mentioned you in a comment`
    : `${authorName} mentioned you in a comment on ${clientCount} clients`;
}

/** Where a grouped bulk notification lands: the list the action ran from. */
export function bulkNotificationLinkPath(): string {
  return "/clients";
}
