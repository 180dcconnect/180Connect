/**
 * Real Supabase rows → the shape the mailbox renders (`InboxThreadView`).
 *
 * The inbox is a mailbox now, not the old bucketed queue, but the grouping rule
 * is unchanged and unchangeable: OUTREACH_MESSAGES stores no gmail_thread_id,
 * so a "thread" is one ORGANISATION's whole outreach history. That is why
 * `InboxThreadView.id` is an organisation id, and why `?thread=<orgId>` is a
 * valid deep link from anywhere in the app.
 *
 * Built on top of @/lib/outreach-inbox rather than beside it — `threadStatus`,
 * `snippetFrom` and `isRecentReply` decide the same things here that they
 * decide for the client page's activity feed, so the two views can never
 * disagree about whether a thread is waiting on somebody.
 *
 * One trap worth naming: @/lib/timeline's `buildEmailSentEntry` returns null
 * for anything that is not `send_status: "sent"`, so drafts and scheduled sends
 * never reach `buildInboxThreads` at all. They are folded in here separately
 * (see `foldPendingRows`) — without that, the Drafts and Scheduled folders
 * would be permanently empty on real data.
 *
 * Pure over flat arrays, so it is testable without a database — same split the
 * rest of @/lib follows.
 */

import { CANONICAL_SECTOR_GROUPS } from "../../app/clients/visible-clients.ts";
import { formatOrganisationType } from "../organisation-format.ts";
import {
  isRecentReply,
  snippetFrom,
  threadStatus,
  type InboxMessageRow,
  type InboxReplyRow,
  type InboxThreadStatus,
} from "../outreach-inbox.ts";
import {
  SECTOR_COLORS,
  type InboxContactView,
  type InboxEmailMessage,
  type InboxThreadView,
} from "../inbox-thread-view.ts";

/** ORGANISATIONS, as much of it as a thread row needs. */
export type InboxOrganisationRow = {
  id: string;
  legal_name: string;
  organisation_type: string | null;
  city: string | null;
  country_code: string | null;
  contact_email: string | null;
  sector: string | null;
  sub_sector: string | null;
  owner: { full_name: string | null; email: string | null } | null;
};

/** CONTACTS — the person a thread is addressed to. Names arrive split, as the
    table stores them; nothing downstream wants the halves. */
export type InboxContactRow = {
  id: string;
  organisation_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  phone: string | null;
  is_primary: boolean | null;
};

/** "Ada Lovelace" from the two columns, blank when neither is set. */
export function contactName(contact: {
  first_name: string | null;
  last_name: string | null;
}): string {
  return [contact.first_name, contact.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * A draft or scheduled OUTREACH_MESSAGES row. Deliberately a separate input
 * from `InboxMessageRow`: those are events that happened, these are intentions
 * that have not, and only the latter can populate the Drafts/Scheduled folders.
 */
export type InboxPendingRow = {
  id: string;
  organisation_id: string;
  subject: string | null;
  send_status: "draft" | "scheduled";
  scheduled_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export type BuildRealInboxThreadsInput = {
  /** send_status = 'sent' rows. Bodies are NOT needed — see the note below. */
  messages: readonly InboxMessageRow[];
  replies: readonly InboxReplyRow[];
  pending: readonly InboxPendingRow[];
  organisations: readonly InboxOrganisationRow[];
  contacts: readonly InboxContactRow[];
  /** organisation_id → count. Absent means zero. */
  noteCounts?: ReadonlyMap<string, number>;
  handoverCounts?: ReadonlyMap<string, number>;
  now?: Date;
};

type Sector = InboxThreadView["sector"];

/**
 * The mailbox's five label sectors, mapped from the seven canonical groups the
 * client list already classifies organisations into (CANONICAL_SECTOR_GROUPS in
 * @/app/clients/visible-clients). Reused rather than reinvented so a client
 * filtered as "Health" on /clients never carries a different label here.
 *
 * "Grants & Foundations" has no canonical group behind it — it exists in the
 * mock set and stays reachable as a label, but nothing real classifies into it,
 * and inventing a rule would only mislabel clients confidently.
 */
const SECTOR_BY_GROUP: Record<string, Sector> = {
  health: "Health & Well-being",
  education: "Youth & Education",
  community: "Youth & Education",
  environment: "Environment",
  poverty: "Charities & NGOs",
  arts: "Charities & NGOs",
  justice: "Charities & NGOs",
};

/** The neutral default: a real organisation we cannot classify is a charity or
    NGO, which is what most of the database is. Never a guess at a narrower
    label — a wrong sector filter is worse than a broad one. */
const DEFAULT_SECTOR: Sector = "Charities & NGOs";

/**
 * Same matching the client list's sector filter does: the standardised sector
 * plus its sub-sector, lowercased, matched against the alias table. Both
 * columns are LLM-classified free text, which is why this goes through aliases
 * rather than equality.
 */
export function deriveSector(
  sector: string | null,
  subSector: string | null,
): Sector {
  const text = `${(sector ?? "").trim()} ${(subSector ?? "").trim()}`.toLowerCase();
  if (!text.trim()) return DEFAULT_SECTOR;
  for (const [group, aliases] of Object.entries(CANONICAL_SECTOR_GROUPS)) {
    if (aliases.some((alias) => text.includes(alias))) {
      return SECTOR_BY_GROUP[group] ?? DEFAULT_SECTOR;
    }
  }
  return DEFAULT_SECTOR;
}

/**
 * Which mailbox folder a thread sits in.
 *
 * Note what is NOT here: a "sent" folder for threads that have been answered.
 * In Gmail terms every outbound message is also in Sent, but a thread is one
 * organisation's whole history, so a thread can only live in one folder — and
 * the folder that matters is the one that says whether it needs the CAM. Live
 * conversations stay in the inbox; only intentions that have not gone out yet
 * (drafts, scheduled sends) live elsewhere.
 */
export function deriveFolder(
  hasSent: boolean,
  pending: InboxPendingRow | null,
): InboxThreadView["folder"] {
  if (hasSent) return "inbox";
  if (pending?.send_status === "scheduled") return "scheduled";
  if (pending?.send_status === "draft") return "drafts";
  return "inbox";
}

/**
 * Every CONTACTS row the organisation holds, primary first, as the compose
 * window's recipient lookup consumes them.
 *
 * Contacts with no address are dropped rather than listed: an entry that
 * cannot be written into a To: field is not a recipient. The organisation's
 * own `contact_email` is appended when no contact row carries it, because that
 * is the address `sendReviewedEmail` falls back to — offering less than the
 * send path would accept is how a CAM ends up typing an address by hand.
 */
function contactsFor(
  organisation: InboxOrganisationRow,
  contacts: readonly InboxContactRow[],
): InboxContactView[] {
  const own = contacts
    .filter((row) => row.organisation_id === organisation.id)
    .filter((row) => Boolean(row.email?.trim()));

  const views: InboxContactView[] = own.map((row) => {
    const name = contactName(row);
    const [firstName, ...rest] = name ? name.split(" ") : [""];
    return {
      id: row.id,
      organisationId: organisation.id,
      firstName: firstName ?? "",
      lastName: rest.join(" "),
      email: row.email!.trim(),
      jobTitle: row.job_title?.trim() || "Contact",
      isPrimary: row.is_primary === true,
    };
  });

  const fallback = organisation.contact_email?.trim();
  if (fallback && !views.some((view) => view.email.toLowerCase() === fallback.toLowerCase())) {
    views.push({
      id: `${organisation.id}-contact-email`,
      organisationId: organisation.id,
      firstName: "",
      lastName: "",
      email: fallback,
      jobTitle: "Organisation address",
      isPrimary: views.length === 0,
    });
  }

  return views.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

function primaryContactFor(
  organisation: InboxOrganisationRow,
  contacts: readonly InboxContactRow[],
): InboxThreadView["primaryContact"] {
  const own = contacts.filter((row) => row.organisation_id === organisation.id);
  const chosen = own.find((row) => row.is_primary) ?? own[0] ?? null;
  return {
    name: (chosen ? contactName(chosen) : "") || organisation.legal_name,
    role: chosen?.job_title?.trim() || "Contact",
    email: chosen?.email?.trim() || organisation.contact_email?.trim() || "",
    phone: chosen?.phone?.trim() || undefined,
  };
}

/**
 * Groups messages and replies into per-organisation events. This mirrors what
 * `buildInboxThreads` does internally, but keeps the raw rows so the caller can
 * hydrate message bodies later — the list itself never needs them.
 */
function eventsByOrganisation(
  messages: readonly InboxMessageRow[],
  replies: readonly InboxReplyRow[],
): Map<
  string,
  Array<{
    type: "email_sent" | "reply_received";
    timestamp: string;
    subject: string | null;
    snippet: string;
    intent: string | null;
  }>
> {
  const byOrg = new Map<
    string,
    Array<{
      type: "email_sent" | "reply_received";
      timestamp: string;
      subject: string | null;
      snippet: string;
      intent: string | null;
    }>
  >();

  const push = (orgId: string, event: {
    type: "email_sent" | "reply_received";
    timestamp: string;
    subject: string | null;
    snippet: string;
    intent: string | null;
  }) => {
    const bucket = byOrg.get(orgId) ?? [];
    bucket.push(event);
    byOrg.set(orgId, bucket);
  };

  for (const row of messages) {
    // Same rule @/lib/timeline enforces: only a genuinely sent row is an event.
    if (row.send_status !== "sent" || !row.sent_at) continue;
    push(row.organisation_id, {
      type: "email_sent",
      timestamp: row.sent_at,
      subject: row.subject,
      snippet: snippetFrom(row.subject),
      intent: null,
    });
  }

  for (const row of replies) {
    push(row.organisation_id, {
      type: "reply_received",
      timestamp: row.received_at,
      subject: null,
      snippet: snippetFrom(row.reply_body),
      intent: row.intent?.trim() || null,
    });
  }

  // Newest first, which is what threadStatus reads and what the row shows.
  for (const bucket of byOrg.values()) {
    bucket.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  }
  return byOrg;
}

/** The newest draft/scheduled row per organisation, scheduled winning a tie —
    a queued send is a firmer intention than an unsent draft. */
function foldPendingRows(
  pending: readonly InboxPendingRow[],
): Map<string, InboxPendingRow> {
  const byOrg = new Map<string, InboxPendingRow>();
  for (const row of pending) {
    const current = byOrg.get(row.organisation_id);
    if (!current) {
      byOrg.set(row.organisation_id, row);
      continue;
    }
    if (current.send_status === "scheduled" && row.send_status !== "scheduled") continue;
    if (row.send_status === "scheduled" && current.send_status !== "scheduled") {
      byOrg.set(row.organisation_id, row);
      continue;
    }
    const currentAt = current.updated_at ?? current.created_at ?? "";
    const rowAt = row.updated_at ?? row.created_at ?? "";
    if (rowAt > currentAt) byOrg.set(row.organisation_id, row);
  }
  return byOrg;
}

const REPLY_INTENTS = new Set(["interested", "not_interested", "more_info", "referral"]);

function asReplyIntent(intent: string | null): InboxThreadView["replyIntent"] {
  return intent && REPLY_INTENTS.has(intent)
    ? (intent as NonNullable<InboxThreadView["replyIntent"]>)
    : null;
}

/**
 * The list view. Every organisation with outreach on it — sent, replied to,
 * drafted or scheduled — becomes one thread row.
 *
 * `messages` deliberately carries no bodies. The list renders `subject` and
 * `snippet` only, and selecting `outreach_messages.body` for every row of every
 * organisation would move megabytes of email HTML on every page load. Bodies
 * arrive per thread, on open, through `hydrateInboxThread`.
 */
export function buildRealInboxThreads({
  messages,
  replies,
  pending,
  organisations,
  contacts,
  noteCounts,
  handoverCounts,
  now = new Date(),
}: BuildRealInboxThreadsInput): InboxThreadView[] {
  const events = eventsByOrganisation(messages, replies);
  const pendingByOrg = foldPendingRows(pending);

  const threads: InboxThreadView[] = [];

  for (const organisation of organisations) {
    const own = events.get(organisation.id) ?? [];
    const queued = pendingByOrg.get(organisation.id) ?? null;
    // An organisation nobody has touched is not a thread — it is a client, and
    // it belongs on /clients.
    if (own.length === 0 && !queued) continue;

    const newest = own[0] ?? null;
    const status: InboxThreadStatus = threadStatus(own);
    const sector = deriveSector(organisation.sector, organisation.sub_sector);
    const folder = deriveFolder(own.length > 0, queued);

    // A queued send with no history yet has no event to date the row by, so it
    // is dated by when it was last touched.
    const lastActivityAt =
      newest?.timestamp ?? queued?.updated_at ?? queued?.created_at ?? new Date(0).toISOString();

    const subject =
      own.find((event) => event.type === "email_sent")?.subject ??
      queued?.subject ??
      "(no subject)";

    threads.push({
      id: organisation.id,
      orgName: organisation.legal_name,
      orgType: organisation.organisation_type
        ? formatOrganisationType(organisation.organisation_type)
        : "Organisation",
      city: organisation.city ?? "",
      country: organisation.country_code ?? "",
      sector,
      labelColor: SECTOR_COLORS[sector],
      primaryContact: primaryContactFor(organisation, contacts),
      contacts: contactsFor(organisation, contacts),
      camOwner: {
        name: organisation.owner?.full_name?.trim() || "Unassigned",
        email: organisation.owner?.email?.trim() || "",
      },
      status: folder === "drafts" ? "draft" : status,
      replyIntent: asReplyIntent(newest?.intent ?? null),
      subject,
      snippet: newest?.snippet ?? snippetFrom(queued?.subject ?? ""),
      lastActivityAt,
      // No per-user read state exists in the schema, so "unread" is the one
      // thing a CAM actually opens the inbox to find: a reply nobody has
      // answered yet. Everything else reads as already seen.
      isRead: status !== "replied",
      // Starring and importance are per-viewer facts with nowhere to live yet.
      // The shell toggles them in local state; they reset on reload, which is
      // honest about there being no storage behind them.
      isStarred: false,
      isImportant: false,
      folder,
      scheduledFor: queued?.send_status === "scheduled" ? (queued.scheduled_at ?? undefined) : undefined,
      // Filled by hydrateInboxThread when the thread is opened.
      messages: [],
      attachments: [],
      notesCount: noteCounts?.get(organisation.id) ?? 0,
      handoversCount: handoverCounts?.get(organisation.id) ?? 0,
    });
  }

  return sortInboxThreads(threads, now);
}

/** Newest activity first, with a fresh reply lifted above an equally recent
    send — the row a CAM came to find should never be the second one. */
export function sortInboxThreads(
  threads: readonly InboxThreadView[],
  now: Date = new Date(),
): InboxThreadView[] {
  return [...threads].sort((a, b) => {
    const aFresh = a.status === "replied" && isRecentReply(a.lastActivityAt, now);
    const bFresh = b.status === "replied" && isRecentReply(b.lastActivityAt, now);
    if (aFresh !== bFresh) return aFresh ? -1 : 1;
    return a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0;
  });
}

/**
 * Mock threads fill in behind the real ones while the live database is thin.
 * A real organisation always wins its own id — the fill can add rows, never
 * shadow one.
 *
 * Pure set union, no sorting: ordering is `sortInboxThreads`'s job, and doing
 * it here would hide that the merged list needs re-sorting at all.
 */
export function mergeWithMockFill(
  real: readonly InboxThreadView[],
  mock: readonly InboxThreadView[],
): InboxThreadView[] {
  const realIds = new Set(real.map((thread) => thread.id));
  return [...real, ...mock.filter((thread) => !realIds.has(thread.id))];
}

/**
 * One thread's messages, in reading order, for the reading pane. Called when a
 * thread is opened — never for the list.
 */
export function hydrateInboxThread(
  thread: InboxThreadView,
  messages: readonly (InboxMessageRow & { body?: string | null })[],
  replies: readonly InboxReplyRow[],
  contactNames: ReadonlyMap<string, string> = new Map(),
): InboxThreadView {
  const entries: InboxEmailMessage[] = [];

  for (const row of messages) {
    if (row.organisation_id !== thread.id) continue;
    if (row.send_status !== "sent" || !row.sent_at) continue;
    entries.push({
      id: row.id,
      senderName: thread.camOwner.name,
      senderEmail: thread.camOwner.email,
      recipientName: thread.primaryContact.name,
      recipientEmail: thread.primaryContact.email,
      sentAt: row.sent_at,
      subject: row.subject ?? "(no subject)",
      body: row.body ?? "",
      isFromClient: false,
    });
  }

  for (const row of replies) {
    if (row.organisation_id !== thread.id) continue;
    const contactName = row.contact_id ? contactNames.get(row.contact_id) : null;
    entries.push({
      id: row.id,
      senderName: contactName?.trim() || thread.primaryContact.name,
      senderEmail: thread.primaryContact.email,
      senderRole: thread.primaryContact.role,
      recipientName: thread.camOwner.name,
      recipientEmail: thread.camOwner.email,
      sentAt: row.received_at,
      subject: thread.subject,
      body: row.reply_body,
      isFromClient: true,
      intent: asReplyIntent(row.intent?.trim() || null),
    });
  }

  entries.sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0));
  return { ...thread, messages: entries };
}
