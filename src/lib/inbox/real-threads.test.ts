import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildAddressableClients,
  buildRealInboxThreads,
  deriveFolder,
  deriveSector,
  hydrateInboxThread,
  mergeWithMockFill,
  sortInboxThreads,
  type InboxContactRow,
  type InboxOrganisationRow,
  type InboxPendingRow,
} from "./real-threads.ts";
import type { InboxMessageRow, InboxReplyRow } from "../outreach-inbox.ts";
import type { InboxThreadView } from "../inbox-thread-view.ts";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

function organisation(overrides: Partial<InboxOrganisationRow> = {}): InboxOrganisationRow {
  return {
    id: ORG_A,
    legal_name: "Test Charity",
    organisation_type: "charity",
    city: "Sheffield",
    country_code: "GB",
    contact_email: "info@testcharity.org",
    sector: null,
    sub_sector: null,
    owner: { full_name: "Ada Lovelace", email: "ada.lovelace@180dc.org" },
    ...overrides,
  };
}

function sentMessage(overrides: Partial<InboxMessageRow> = {}): InboxMessageRow {
  return {
    id: "msg-1",
    organisation_id: ORG_A,
    subject: "180DC x Test Charity",
    send_status: "sent",
    sent_at: "2026-09-01T09:00:00.000Z",
    sender: { full_name: "Ada Lovelace" },
    ...overrides,
  } as unknown as InboxMessageRow;
}

function reply(overrides: Partial<InboxReplyRow> = {}): InboxReplyRow {
  return {
    id: "reply-1",
    organisation_id: ORG_A,
    reply_body: "Thanks — we would like to hear more.",
    received_at: "2026-09-02T09:00:00.000Z",
    intent: "interested",
    contact_id: null,
    ...overrides,
  } as unknown as InboxReplyRow;
}

function pendingRow(overrides: Partial<InboxPendingRow> = {}): InboxPendingRow {
  return {
    id: "pending-1",
    organisation_id: ORG_A,
    subject: "Draft subject",
    send_status: "draft",
    scheduled_at: null,
    updated_at: "2026-09-03T09:00:00.000Z",
    created_at: "2026-09-03T08:00:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-09-04T09:00:00.000Z");

describe("deriveFolder", () => {
  it("keeps a thread with sent history in the inbox", () => {
    assert.equal(deriveFolder(true, null), "inbox");
  });

  it("keeps a thread with sent history in the inbox even while a draft exists", () => {
    // A live conversation is not a draft, whatever else is half-written.
    assert.equal(deriveFolder(true, pendingRow()), "inbox");
  });

  it("files an unsent draft under drafts", () => {
    assert.equal(deriveFolder(false, pendingRow()), "drafts");
  });

  it("files a queued send under scheduled", () => {
    assert.equal(
      deriveFolder(false, pendingRow({ send_status: "scheduled", scheduled_at: "2026-09-10T09:00:00.000Z" })),
      "scheduled",
    );
  });
});

describe("deriveSector", () => {
  it("maps the client list's canonical groups onto the mailbox's labels", () => {
    assert.equal(deriveSector("Health", null), "Health & Well-being");
    assert.equal(deriveSector("Education", null), "Youth & Education");
    assert.equal(deriveSector(null, "youth"), "Youth & Education");
    assert.equal(deriveSector("Conservation", null), "Environment");
  });

  it("falls back to the broad label rather than guessing a narrow one", () => {
    assert.equal(deriveSector(null, null), "Charities & NGOs");
    assert.equal(deriveSector("something nobody classified", null), "Charities & NGOs");
  });
});

describe("buildRealInboxThreads", () => {
  it("builds one thread per organisation, keyed by the organisation id", () => {
    const threads = buildRealInboxThreads({
      messages: [sentMessage(), sentMessage({ id: "msg-2", sent_at: "2026-09-01T10:00:00.000Z" })],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });

    assert.equal(threads.length, 1);
    assert.equal(threads[0].id, ORG_A);
  });

  it("marks a thread with the newest reply as replied and unread", () => {
    const [thread] = buildRealInboxThreads({
      messages: [sentMessage()],
      replies: [reply()],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });

    assert.equal(thread.status, "replied");
    assert.equal(thread.replyIntent, "interested");
    // No per-user read state exists, so an unanswered reply is the one thing
    // that reads as unread.
    assert.equal(thread.isRead, false);
  });

  it("surfaces a draft-only organisation, which the sent-events pipeline cannot", () => {
    // buildEmailSentEntry returns null for anything unsent, so without the
    // separate pending input the Drafts folder is permanently empty.
    const [thread] = buildRealInboxThreads({
      messages: [],
      replies: [],
      pending: [pendingRow()],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });

    assert.equal(thread.folder, "drafts");
    assert.equal(thread.status, "draft");
    assert.equal(thread.subject, "Draft subject");
  });

  it("carries a scheduled send's due date onto the thread", () => {
    const [thread] = buildRealInboxThreads({
      messages: [],
      replies: [],
      pending: [
        pendingRow({ send_status: "scheduled", scheduled_at: "2026-09-10T09:00:00.000Z" }),
      ],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });

    assert.equal(thread.folder, "scheduled");
    assert.equal(thread.scheduledFor, "2026-09-10T09:00:00.000Z");
  });

  it("prefers a queued send over an older draft on the same client", () => {
    const [thread] = buildRealInboxThreads({
      messages: [],
      replies: [],
      pending: [
        pendingRow({ id: "d", updated_at: "2026-09-03T23:00:00.000Z" }),
        pendingRow({
          id: "s",
          send_status: "scheduled",
          scheduled_at: "2026-09-11T09:00:00.000Z",
          updated_at: "2026-09-03T09:00:00.000Z",
        }),
      ],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });

    assert.equal(thread.folder, "scheduled");
  });

  it("leaves an organisation nobody has touched out of the mailbox entirely", () => {
    const threads = buildRealInboxThreads({
      messages: [],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });

    assert.deepEqual(threads, []);
  });

  it("prefers the primary contact, falling back to the organisation's address", () => {
    const contacts: InboxContactRow[] = [
      {
        id: "c1",
        organisation_id: ORG_A,
        first_name: "Jo",
        last_name: "Secondary",
        email: "enquiries@testcharity.org",
        job_title: "Fundraiser",
        phone: null,
        is_primary: false,
      },
      {
        id: "c2",
        organisation_id: ORG_A,
        first_name: "Sam",
        last_name: "Primary",
        email: "partnerships@testcharity.org",
        job_title: "Head of Partnerships",
        phone: "+44 114 000 0000",
        is_primary: true,
      },
    ];

    const [withContacts] = buildRealInboxThreads({
      messages: [sentMessage()],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts,
      now: NOW,
    });
    assert.equal(withContacts.primaryContact.email, "partnerships@testcharity.org");
    assert.equal(withContacts.primaryContact.name, "Sam Primary");

    const [withoutContacts] = buildRealInboxThreads({
      messages: [sentMessage()],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });
    assert.equal(withoutContacts.primaryContact.email, "info@testcharity.org");
  });

  it("counts notes and handovers from the maps the route supplies", () => {
    const [thread] = buildRealInboxThreads({
      messages: [sentMessage()],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      noteCounts: new Map([[ORG_A, 3]]),
      handoverCounts: new Map([[ORG_A, 1]]),
      now: NOW,
    });

    assert.equal(thread.notesCount, 3);
    assert.equal(thread.handoversCount, 1);
  });
});

describe("mergeWithMockFill", () => {
  const fill = (id: string): InboxThreadView =>
    ({ id, orgName: `Fill ${id}`, lastActivityAt: "2026-01-01T00:00:00.000Z" }) as InboxThreadView;

  it("lets a real thread win an id clash with the fill", () => {
    const real = [
      { id: ORG_A, orgName: "The real client", lastActivityAt: "2026-09-01T00:00:00.000Z" },
    ] as InboxThreadView[];

    const merged = mergeWithMockFill(real, [fill(ORG_A), fill("mock-org-other")]);

    assert.equal(merged.length, 2);
    assert.equal(merged.find((thread) => thread.id === ORG_A)?.orgName, "The real client");
    assert.ok(merged.some((thread) => thread.id === "mock-org-other"));
  });

  it("adds fill without reordering — sorting is the caller's job", () => {
    const real = [{ id: ORG_B, lastActivityAt: "2020-01-01T00:00:00.000Z" }] as InboxThreadView[];
    const merged = mergeWithMockFill(real, [fill("mock-org-newer")]);
    assert.deepEqual(
      merged.map((thread) => thread.id),
      [ORG_B, "mock-org-newer"],
    );
  });
});

describe("sortInboxThreads", () => {
  it("lifts a fresh reply above an equally recent send", () => {
    const threads = [
      {
        id: "sent",
        status: "sent",
        lastActivityAt: "2026-09-04T08:00:00.000Z",
      },
      {
        id: "replied",
        status: "replied",
        lastActivityAt: "2026-09-04T07:00:00.000Z",
      },
    ] as InboxThreadView[];

    assert.deepEqual(
      sortInboxThreads(threads, NOW).map((thread) => thread.id),
      ["replied", "sent"],
    );
  });

  it("otherwise orders by newest activity", () => {
    const threads = [
      { id: "old", status: "sent", lastActivityAt: "2026-08-01T00:00:00.000Z" },
      { id: "new", status: "sent", lastActivityAt: "2026-09-03T00:00:00.000Z" },
    ] as InboxThreadView[];

    assert.deepEqual(
      sortInboxThreads(threads, NOW).map((thread) => thread.id),
      ["new", "old"],
    );
  });
});

describe("hydrateInboxThread", () => {
  it("interleaves sends and replies oldest first", () => {
    const [thread] = buildRealInboxThreads({
      messages: [sentMessage()],
      replies: [reply()],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });
    // The list never carries bodies — that is the whole point of hydrating.
    assert.deepEqual(thread.messages, []);

    const hydrated = hydrateInboxThread(
      thread,
      [{ ...sentMessage(), body: "<p>Our opening pitch</p>" }],
      [reply()],
      new Map([["c2", "Sam Primary"]]),
    );

    assert.deepEqual(
      hydrated.messages.map((message) => [message.isFromClient, message.body]),
      [
        [false, "<p>Our opening pitch</p>"],
        [true, "Thanks — we would like to hear more."],
      ],
    );
  });

  it("ignores rows belonging to another organisation", () => {
    const [thread] = buildRealInboxThreads({
      messages: [sentMessage()],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });

    const hydrated = hydrateInboxThread(
      thread,
      [{ ...sentMessage({ id: "other", organisation_id: ORG_B }), body: "not ours" }],
      [],
    );

    assert.deepEqual(hydrated.messages, []);
  });

  it("names a reply after the contact who sent it when one resolves", () => {
    const [thread] = buildRealInboxThreads({
      messages: [sentMessage()],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });

    const hydrated = hydrateInboxThread(
      thread,
      [],
      [reply({ contact_id: "c9" })],
      new Map([["c9", "Sam Primary"]]),
    );

    assert.equal(hydrated.messages[0].senderName, "Sam Primary");
  });
});

describe("buildRealInboxThreads — thread tags", () => {
  it("hangs the organisation's tags on the thread, sorted by name", () => {
    const [thread] = buildRealInboxThreads({
      messages: [sentMessage()],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      orgTags: new Map([
        [
          ORG_A,
          [
            { id: "t2", name: "Spring Cycle", colour: "#067647" },
            { id: "t1", name: "Autumn Cycle", colour: null },
          ],
        ],
      ]),
      now: NOW,
    });

    assert.deepEqual(
      thread.tags.map((tag) => tag.name),
      ["Autumn Cycle", "Spring Cycle"],
    );
    assert.equal(thread.tags[1].colour, "#067647");
  });

  it("gives a thread with no tags an empty array, not undefined", () => {
    const [thread] = buildRealInboxThreads({
      messages: [sentMessage()],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts: [],
      now: NOW,
    });

    assert.deepEqual(thread.tags, []);
  });
});

describe("buildAddressableClients", () => {
  const contact = (overrides: Partial<InboxContactRow> = {}): InboxContactRow => ({
    id: "c1",
    organisation_id: ORG_A,
    first_name: "Sam",
    last_name: "Primary",
    email: "partnerships@testcharity.org",
    job_title: "Head of Partnerships",
    phone: null,
    is_primary: true,
    ...overrides,
  });

  it("includes a client nobody has emailed yet", () => {
    // The regression this exists for: the compose window used to search the
    // thread list, which excludes an organisation with no outreach — so the
    // first email to a client could not be started from the inbox at all.
    const threads = buildRealInboxThreads({
      messages: [],
      replies: [],
      pending: [],
      organisations: [organisation()],
      contacts: [contact()],
      now: NOW,
    });
    assert.deepEqual(threads, [], "no outreach means no thread");

    const clients = buildAddressableClients({
      organisations: [organisation()],
      contacts: [contact()],
    });
    assert.equal(clients.length, 1);
    assert.equal(clients[0].id, ORG_A);
    assert.equal(clients[0].orgName, "Test Charity");
  });

  it("carries every address the organisation holds, primary first", () => {
    const clients = buildAddressableClients({
      organisations: [organisation()],
      contacts: [
        contact({ id: "c1", email: "enquiries@testcharity.org", is_primary: false }),
        contact({ id: "c2", email: "partnerships@testcharity.org", is_primary: true }),
      ],
    });
    assert.deepEqual(
      clients[0].contacts.map((c) => c.email),
      ["partnerships@testcharity.org", "enquiries@testcharity.org", "info@testcharity.org"],
    );
    assert.equal(clients[0].contacts[0].isPrimary, true);
  });

  it("falls back to the organisation's own address when it has no contact rows", () => {
    const clients = buildAddressableClients({
      organisations: [organisation()],
      contacts: [],
    });
    assert.deepEqual(
      clients[0].contacts.map((c) => c.email),
      ["info@testcharity.org"],
    );
  });

  it("drops an organisation with no address at all", () => {
    // Nothing to write into a To: field, so offering it would produce a
    // recipient that Send could never honour.
    const clients = buildAddressableClients({
      organisations: [organisation({ contact_email: null })],
      contacts: [],
    });
    assert.deepEqual(clients, []);
  });

  it("ignores contacts belonging to another organisation", () => {
    const clients = buildAddressableClients({
      organisations: [organisation({ contact_email: null })],
      contacts: [contact({ organisation_id: ORG_B })],
    });
    assert.deepEqual(clients, []);
  });

  it("orders by organisation name", () => {
    const clients = buildAddressableClients({
      organisations: [
        organisation({ id: ORG_B, legal_name: "Zebra Trust", contact_email: "info@zebra.org" }),
        organisation({ legal_name: "Alpha Trust" }),
      ],
      contacts: [],
    });
    assert.deepEqual(
      clients.map((c) => c.orgName),
      ["Alpha Trust", "Zebra Trust"],
    );
  });
});
