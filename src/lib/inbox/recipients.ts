/**
 * Who the compose window may address, and how a typed query finds them.
 *
 * A recipient list is a projection of CONTACTS, not an invention: what can be
 * picked here is exactly what the organisation is reachable on. An earlier
 * version derived stand-in contacts from the thread, which meant the dropdown
 * offered addresses (`partnerships@…`, `info@…`) that were never on the record
 * and Send was enabled for them.
 */

import type { InboxContactView } from "../inbox-thread-view.ts";

/**
 * The least a thing needs to be searchable as a recipient.
 *
 * Structural rather than a named union, because more than one thing is searched
 * here and neither should have to become the other: an `AddressableClient`
 * (every organisation, whether it has been emailed or not — see
 * ./real-threads.ts) and any caller that only has threads to hand.
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
 * ./real-threads.ts); anything without them offers no addresses.
 */
export function threadContacts(source: RecipientSource): InboxContactView[] {
  return source.contacts ?? [];
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
