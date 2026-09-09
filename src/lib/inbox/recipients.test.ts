import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { MOCK_INBOX_THREADS } from "../inbox-mock-data.ts";
import type { InboxThreadView } from "../inbox-thread-view.ts";
import { resolveRecipientThread, searchRecipients, threadContacts } from "./recipients.ts";

/** A real thread carries its CONTACTS rows; the fill does not. */
function realThread(overrides: Partial<InboxThreadView> = {}): InboxThreadView {
  const base = MOCK_INBOX_THREADS[0];
  return {
    ...base,
    id: "11111111-1111-4111-8111-111111111111",
    orgName: "Northgate Trust",
    primaryContact: {
      name: "Dana Okafor",
      role: "Director",
      email: "enquiries@northgate.org",
    },
    contacts: [
      {
        id: "c1",
        organisationId: "11111111-1111-4111-8111-111111111111",
        firstName: "Dana",
        lastName: "Okafor",
        email: "enquiries@northgate.org",
        jobTitle: "Director",
        isPrimary: true,
      },
    ],
    ...overrides,
  };
}

describe("threadContacts", () => {
  it("uses the thread's own CONTACTS rows when it has them", () => {
    const contacts = threadContacts(realThread());
    assert.deepEqual(
      contacts.map((contact) => contact.email),
      ["enquiries@northgate.org"],
    );
  });

  it("never invents an extra address for a real organisation", () => {
    // The regression this whole module exists for: the derived stand-ins used
    // to add a second named contact and an info@ address to EVERY thread, so a
    // real charity was offered addresses that were not on its record — and,
    // because the thread resolved to a real organisation id, Send accepted them.
    const contacts = threadContacts(realThread());
    assert.equal(contacts.length, 1);
    assert.equal(
      contacts.some((contact) => contact.email.startsWith("info@")),
      false,
    );
  });

  it("falls back to derived stand-ins for a design fill thread", () => {
    const fill = MOCK_INBOX_THREADS[0];
    assert.equal(fill.contacts, undefined);
    assert.ok(threadContacts(fill).length >= 2);
  });

  it("treats an empty contacts array as 'no addresses', not as missing", () => {
    const contacts = threadContacts(realThread({ contacts: [] }));
    assert.deepEqual(contacts, []);
  });
});

describe("searchRecipients", () => {
  it("finds a real organisation by name, contact name and address", () => {
    const threads = [realThread()];
    for (const query of ["northgate", "dana", "enquiries@north"]) {
      const matches = searchRecipients(query, 6, threads);
      assert.equal(matches.length, 1, `no match for "${query}"`);
      assert.equal(matches[0].contact.email, "enquiries@northgate.org");
    }
  });

  it("offers nothing when there are no threads to search", () => {
    assert.deepEqual(searchRecipients("northgate", 6, []), []);
  });

  it("skips trashed threads", () => {
    const threads = [realThread({ folder: "trash" })];
    assert.deepEqual(searchRecipients("northgate", 6, threads), []);
  });

  it("ranks the organisation-name hit above an address-only hit", () => {
    const other = realThread({
      id: "22222222-2222-4222-8222-222222222222",
      orgName: "Harbour Fund",
      contacts: [
        {
          id: "c2",
          organisationId: "22222222-2222-4222-8222-222222222222",
          firstName: "",
          lastName: "",
          email: "northgate@harbourfund.org",
          jobTitle: "General enquiries",
          isPrimary: true,
        },
      ],
    });
    const matches = searchRecipients("northgate", 6, [other, realThread()]);
    assert.equal(matches[0].thread.orgName, "Northgate Trust");
  });
});

describe("resolveRecipientThread", () => {
  it("matches any of the organisation's addresses, not only the primary", () => {
    const thread = realThread({
      contacts: [
        {
          id: "c1",
          organisationId: "11111111-1111-4111-8111-111111111111",
          firstName: "Dana",
          lastName: "Okafor",
          email: "enquiries@northgate.org",
          jobTitle: "Director",
          isPrimary: true,
        },
        {
          id: "c2",
          organisationId: "11111111-1111-4111-8111-111111111111",
          firstName: "",
          lastName: "",
          email: "finance@northgate.org",
          jobTitle: "Finance",
          isPrimary: false,
        },
      ],
    });
    assert.equal(resolveRecipientThread("finance@northgate.org", [thread])?.id, thread.id);
    assert.equal(resolveRecipientThread("FINANCE@NORTHGATE.ORG", [thread])?.id, thread.id);
  });

  it("returns null for an address on no record, and for an empty query", () => {
    assert.equal(resolveRecipientThread("stranger@example.org", [realThread()]), null);
    assert.equal(resolveRecipientThread("   ", [realThread()]), null);
  });
});
