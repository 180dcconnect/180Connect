/**
 * Who the compose window may address, and how a typed query finds them.
 *
 * This used to live in `@/lib/inbox-mock-data` and read stand-in contacts
 * derived from the thread — which meant that with real clients loaded, the
 * recipient dropdown offered addresses (`partnerships@…`, `info@…`) that were
 * never on the record, and Send was enabled for them. A recipient list must be
 * a projection of CONTACTS, not an invention: what can be picked here is
 * exactly what the organisation is reachable on.
 *
 * The design fill has no CONTACTS rows behind it, so a fill thread still falls
 * back to the derived stand-ins — a fill row is never sendable anyway (see
 * `directory` in gmail-compose-modal.tsx), so nothing addressable comes out of
 * that branch.
 */

import { deriveFillContacts } from "../inbox-mock-data.ts";
import type { InboxContactView, InboxThreadView } from "../inbox-thread-view.ts";
import type { AddressableClient } from "./real-threads.ts";

/**
 * The least a thing needs to be searchable as a recipient.
 *
 * Structural rather than a named union, because two different things are
 * searched here and neither should have to become the other: an
 * `AddressableClient` (every organisation, whether it has been emailed or not
 * — see ./real-threads.ts) and an `InboxThreadView` (the design fill, and any
 * caller that only has threads to hand).
 */
export type RecipientSource = {
  id: string;
  orgName: string;
  primaryContact: { name: string; role: string; email: string; phone?: string };
  contacts?: InboxContactView[];
  /** Only threads have one. A trashed thread is not offered as a recipient. */
  folder?: string;
};

/**
 * The addresses this client or thread is reachable on. Anything built from the
 * database carries its own CONTACTS rows (see `contactsFor` in
 * ./real-threads.ts); the design fill has none behind it and derives stand-ins.
 */
export function threadContacts(source: RecipientSource): InboxContactView[] {
  return source.contacts ?? deriveFillContacts(source as InboxThreadView);
}

export type RecipientMatch<T extends RecipientSource = RecipientSource> = {
  contact: InboxContactView;
  thread: T;
};

/**
 * Recipient lookup for the compose field. One query runs against three things
 * at once — the organisation's name, the contact's name, and the address — so
 * a CAM who only remembers the charity finds the address, and one who only
 * remembers the address finds the charity.
 *
 * Organisation-name hits outrank contact-name hits, which outrank address
 * hits; within a rank a prefix beats a substring, and the primary contact
 * comes before their colleagues.
 */
export function searchRecipients<T extends RecipientSource>(
  rawQuery: string,
  limit = 6,
  threads: readonly T[] = [],
): RecipientMatch<T>[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const seen = new Set<string>();
  const scored: Array<{ match: RecipientMatch<T>; score: number; index: number }> = [];

  threads.forEach((thread, index) => {
    if (thread.folder === "trash") return;
    const org = thread.orgName.toLowerCase();

    threadContacts(thread).forEach((contact) => {
      // The same address can sit on more than one thread for an org; the
      // first (highest-ranked) sighting is the one that gets listed.
      const key = contact.email.toLowerCase();
      if (seen.has(key)) return;

      const name = `${contact.firstName} ${contact.lastName}`.trim().toLowerCase();
      let score = 0;
      if (org.startsWith(query)) score = 60;
      else if (org.includes(query)) score = 50;
      else if (name && name.startsWith(query)) score = 40;
      else if (name && name.includes(query)) score = 30;
      else if (key.startsWith(query)) score = 20;
      else if (key.includes(query)) score = 10;
      if (score === 0) return;

      if (contact.isPrimary) score += 5;
      seen.add(key);
      scored.push({ match: { contact, thread }, score, index });
    });
  });

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.match);
}

/**
 * The thread a saved recipient belongs to. Matched on any of the
 * organisation's addresses, not only the primary, since an organisation
 * carries several (CONTACTS is one-to-many).
 */
export function resolveRecipientThread<T extends RecipientSource>(
  email: string,
  threads: readonly T[],
): T | null {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  return (
    threads.find((thread) =>
      threadContacts(thread).some((contact) => contact.email.toLowerCase() === needle),
    ) ?? null
  );
}

/**
 * The design fill, shaped as addressable clients.
 *
 * Only for the case where the database has no clients at all: the compose
 * window falls back to this so its recipient field is demonstrable while
 * testing with the mock set. Send stays disabled for every one of them,
 * because a fill id is not an organisation id and the send would write
 * nothing — see `sendableClient` in gmail-compose-modal.tsx. With
 * `NEXT_PUBLIC_INBOX_MOCK_FILL=0` the fill is empty and so is this.
 */
export function fillAsAddressableClients(
  threads: readonly InboxThreadView[],
): AddressableClient[] {
  return threads.map((thread) => ({
    id: thread.id,
    orgName: thread.orgName,
    orgType: thread.orgType,
    city: thread.city,
    country: thread.country,
    sector: thread.sector,
    primaryContact: thread.primaryContact,
    camOwner: thread.camOwner,
    contacts: threadContacts(thread),
  }));
}
