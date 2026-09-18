import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MENTION_SUGGESTION_LIMIT,
  NOTE_ADDED_NOTIFICATION_TYPE,
  NOTE_MENTIONED_NOTIFICATION_TYPE,
  applyMentionInsertion,
  buildBulkMentionTitle,
  buildBulkOwnerGroupTitle,
  buildMentionNoteTitle,
  buildOwnerNoteTitle,
  bulkNotificationLinkPath,
  countMentionOccurrences,
  filterMentionCandidates,
  groupBulkClientsByOwner,
  limitMentionIdsByOccurrences,
  mentionQueryAtCursor,
  noteNotificationLinkPath,
  ownerAlreadyMentioned,
  sanitizeMentionedUsers,
  shouldNotifyOwner,
  splitNoteContentMentions,
  summariseNoteContent,
  type MentionCandidate,
} from "./note-mentions.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";

function candidates(): MentionCandidate[] {
  return [
    { id: ALICE, fullName: "Alice Ahmed" },
    { id: BOB, fullName: "Bob Osei" },
    { id: CAROL, fullName: "Carol Danvers" },
  ];
}

describe("notification tokens (F485)", () => {
  it("uses open-token types that need no schema change", () => {
    assert.equal(NOTE_ADDED_NOTIFICATION_TYPE, "note_added");
    assert.equal(NOTE_MENTIONED_NOTIFICATION_TYPE, "note_mentioned");
  });

  it("links to the client's notes card with an absolute path", () => {
    const org = "44444444-4444-4444-8444-444444444444";
    const link = noteNotificationLinkPath(org);
    assert.ok(link.startsWith("/"));
    assert.ok(link.includes(org));
    assert.ok(link.includes("notes"));
  });

  it("names the client and the author in both titles", () => {
    assert.equal(
      buildOwnerNoteTitle("Alice Ahmed", "Oxfam Trust"),
      "Alice Ahmed added a note to Oxfam Trust",
    );
    assert.equal(
      buildMentionNoteTitle("Alice Ahmed", "Oxfam Trust"),
      "Alice Ahmed mentioned you in Oxfam Trust",
    );
  });

  it("collapses a note body to a one-line preview", () => {
    assert.equal(summariseNoteContent("  hello\n\n  world  "), "hello world");
    assert.ok(summariseNoteContent("x".repeat(500)).length <= 240);
  });
});

describe("shouldNotifyOwner (F485 owner half)", () => {
  it("notifies the owner when someone else notes", () => {
    assert.equal(shouldNotifyOwner(BOB, ALICE), true);
  });

  it("never self-notifies when the author owns the client", () => {
    assert.equal(shouldNotifyOwner(ALICE, ALICE), false);
  });

  it("notifies nobody for an unowned client without erroring", () => {
    assert.equal(shouldNotifyOwner(null, ALICE), false);
    assert.equal(shouldNotifyOwner("", ALICE), false);
  });

  it("prefers the mention over a duplicate owner notification", () => {
    assert.equal(ownerAlreadyMentioned(BOB, [BOB, CAROL]), true);
    assert.equal(ownerAlreadyMentioned(BOB, [CAROL]), false);
    assert.equal(ownerAlreadyMentioned(null, [CAROL]), false);
  });
});

describe("sanitizeMentionedUsers (F485 mention half)", () => {
  it("passes through a single mention pair", () => {
    assert.deepEqual(sanitizeMentionedUsers([{ id: BOB, name: "Bob Osei" }], ALICE), [
      { id: BOB, name: "Bob Osei" },
    ]);
  });

  it("dedupes a repeated mention of the same user", () => {
    const thrice = [
      { id: BOB, name: "Bob Osei" },
      { id: BOB, name: "Bob Osei" },
      { id: BOB, name: "Bob Osei" },
    ];
    assert.deepEqual(sanitizeMentionedUsers(thrice, ALICE), [{ id: BOB, name: "Bob Osei" }]);
  });

  it("keeps multiple distinct mentions", () => {
    assert.deepEqual(
      sanitizeMentionedUsers(
        [
          { id: BOB, name: "Bob Osei" },
          { id: CAROL, name: "Carol Danvers" },
        ],
        ALICE,
      ),
      [
        { id: BOB, name: "Bob Osei" },
        { id: CAROL, name: "Carol Danvers" },
      ],
    );
  });

  it("drops the author — the author is never notified about their own note", () => {
    assert.deepEqual(
      sanitizeMentionedUsers(
        [
          { id: ALICE, name: "Alice Ahmed" },
          { id: BOB, name: "Bob Osei" },
        ],
        ALICE,
      ),
      [{ id: BOB, name: "Bob Osei" }],
    );
  });

  it("drops malformed pairs rather than throwing", () => {
    assert.deepEqual(
      sanitizeMentionedUsers(
        ["not-a-pair", null, 42, { id: "not-a-uuid", name: "X" }, { id: BOB, name: "  " }, { id: BOB, name: "Bob Osei" }],
        ALICE,
      ),
      [{ id: BOB, name: "Bob Osei" }],
    );
  });

  it("keeps a genuine mention across a rename (submitted name binds, id verifies)", () => {
    // Alice Ahmed becomes Alice Smith after composing but before saving: the
    // text still reads "@Alice Ahmed" and the pair still carries that name,
    // so binding with the submitted name keeps her while the id check (done
    // server-side against active users) still applies.
    const content = "please review @Alice Ahmed";
    const requested = sanitizeMentionedUsers([{ id: ALICE, name: "Alice Ahmed" }], BOB);
    assert.deepEqual(limitMentionIdsByOccurrences(content, requested), [ALICE]);
  });
});

describe("mentionQueryAtCursor (F485 composer)", () => {
  it("detects a query after a trigger @", () => {
    assert.deepEqual(mentionQueryAtCursor("hi @al", 6), { query: "al", start: 3 });
  });

  it("treats a bare @ as an empty query (show everyone)", () => {
    assert.deepEqual(mentionQueryAtCursor("@", 1), { query: "", start: 0 });
    assert.deepEqual(mentionQueryAtCursor("see @", 5), { query: "", start: 4 });
  });

  it("ignores @ inside an email address", () => {
    assert.equal(mentionQueryAtCursor("mail sam@180dc.org", 10), null);
    assert.equal(mentionQueryAtCursor("sam@180dc.org", 4), null);
  });

  it("returns null when there is no @ before the cursor", () => {
    assert.equal(mentionQueryAtCursor("hello world", 11), null);
  });
});

describe("filterMentionCandidates (F485 composer)", () => {
  it("matches case-insensitively on display name", () => {
    assert.deepEqual(
      filterMentionCandidates(candidates(), "ali").map((c) => c.fullName),
      ["Alice Ahmed"],
    );
    assert.deepEqual(
      filterMentionCandidates(candidates(), "OSEI").map((c) => c.fullName),
      ["Bob Osei"],
    );
  });

  it("returns everyone on an empty query, capped for the listbox", () => {
    const many: MentionCandidate[] = Array.from({ length: 30 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      fullName: `Member ${i}`,
    }));
    const result = filterMentionCandidates(many, "");
    assert.equal(result.length, MENTION_SUGGESTION_LIMIT);
  });
});

describe("applyMentionInsertion (F485 composer)", () => {
  it("replaces the @query with the chosen display name", () => {
    const next = applyMentionInsertion("hi @al", 6, { id: BOB, fullName: "Alice Ahmed" });
    assert.equal(next.value, "hi @Alice Ahmed ");
    assert.equal(next.cursor, "hi @Alice Ahmed ".length);
  });
});

describe("splitNoteContentMentions (F485 rendering)", () => {
  const names = ["Alice Ahmed", "Bob Osei", "Al"];

  it("marks a @Name token as a mention", () => {
    const parts = splitNoteContentMentions("Please ask @Alice Ahmed today", names);
    assert.deepEqual(parts, [
      { text: "Please ask ", mention: false },
      { text: "@Alice Ahmed", mention: true },
      { text: " today", mention: false },
    ]);
  });

  it("prefers the longest matching name", () => {
    const parts = splitNoteContentMentions("hi @Alice Ahmed", names);
    assert.deepEqual(parts, [
      { text: "hi ", mention: false },
      { text: "@Alice Ahmed", mention: true },
    ]);
  });

  it("leaves an email address as plain text", () => {
    const parts = splitNoteContentMentions("mail sam@180dc.org for help", names);
    assert.deepEqual(parts, [{ text: "mail sam@180dc.org for help", mention: false }]);
  });

  it("leaves a bare @ with no name as plain text", () => {
    const parts = splitNoteContentMentions("email @ for details", names);
    assert.deepEqual(parts, [{ text: "email @ for details", mention: false }]);
  });

  it("leaves an unknown name as plain text", () => {
    const parts = splitNoteContentMentions("ask @Nobody Here today", names);
    assert.deepEqual(parts, [{ text: "ask @Nobody Here today", mention: false }]);
  });

  it("still reads as plain text when nothing matches", () => {
    const parts = splitNoteContentMentions("just a note", names);
    assert.deepEqual(parts, [{ text: "just a note", mention: false }]);
  });

  it("renders everything plain when no names are known", () => {
    const parts = splitNoteContentMentions("ask @Alice Ahmed", []);
    assert.deepEqual(parts, [{ text: "ask @Alice Ahmed", mention: false }]);
  });
});

describe("groupBulkClientsByOwner (F485 on F065)", () => {
  const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const ORG_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  function clients() {
    return [
      { organisationId: ORG_A, organisationName: "Alpha", ownerId: BOB },
      { organisationId: ORG_B, organisationName: "Beta", ownerId: BOB },
      { organisationId: ORG_C, organisationName: "Gamma", ownerId: CAROL },
    ];
  }

  it("groups an owner's clients into one entry", () => {
    const groups = groupBulkClientsByOwner(clients(), ALICE);
    assert.equal(groups.size, 2);
    assert.deepEqual(
      groups.get(BOB)?.map((c) => c.organisationId),
      [ORG_A, ORG_B],
    );
    assert.deepEqual(
      groups.get(CAROL)?.map((c) => c.organisationId),
      [ORG_C],
    );
  });

  it("drops unowned clients and the author's own", () => {
    const groups = groupBulkClientsByOwner(
      [
        ...clients(),
        { organisationId: ORG_A, organisationName: "Unowned", ownerId: null },
        { organisationId: ORG_B, organisationName: "Mine", ownerId: ALICE },
      ],
      ALICE,
    );
    assert.equal(groups.size, 2);
    assert.ok(!groups.has(ALICE));
  });

  it("notifies nobody when every client is unowned", () => {
    const groups = groupBulkClientsByOwner(
      [{ organisationId: ORG_A, organisationName: "Alpha", ownerId: null }],
      ALICE,
    );
    assert.equal(groups.size, 0);
  });

  it("titles a grouped owner notification with the count", () => {
    assert.equal(
      buildBulkOwnerGroupTitle("Alice Ahmed", 3),
      "Alice Ahmed added a comment to 3 clients you own",
    );
    assert.equal(
      buildBulkOwnerGroupTitle("Alice Ahmed", 1),
      "Alice Ahmed added a comment to 1 client you own",
    );
  });

  it("titles a grouped mention with the count, singular without one", () => {
    assert.equal(
      buildBulkMentionTitle("Alice Ahmed", 4),
      "Alice Ahmed mentioned you in a comment on 4 clients",
    );
    assert.equal(
      buildBulkMentionTitle("Alice Ahmed", 1),
      "Alice Ahmed mentioned you in a comment",
    );
  });

  it("links grouped notifications to the client list", () => {
    assert.equal(bulkNotificationLinkPath(), "/clients");
  });
});

describe("countMentionOccurrences + limitMentionIdsByOccurrences (F485 review)", () => {
  it("counts a plain mention", () => {
    assert.equal(countMentionOccurrences("ask @Alice Ahmed today", "Alice Ahmed"), 1);
  });

  it("counts repeated mentions", () => {
    assert.equal(countMentionOccurrences("@Bob and @Bob again", "Bob"), 2);
  });

  it("ignores @ inside an email address", () => {
    assert.equal(countMentionOccurrences("mail sam@180dc.org", "180dc.org"), 0);
  });

  it("stops counting once the name is extended with more text", () => {
    assert.equal(countMentionOccurrences("ask @Sam Leeds", "Sam Lee"), 0);
  });

  it("treats a hyphenated extension as a different name", () => {
    assert.equal(countMentionOccurrences("ask @Sam Lee-Smith", "Sam Lee"), 0);
  });

  it("still counts a mention ending the sentence", () => {
    assert.equal(countMentionOccurrences("please ask @Sam Lee.", "Sam Lee"), 1);
  });

  it("still counts a possessive mention", () => {
    assert.equal(countMentionOccurrences("use @Sam Lee's draft", "Sam Lee"), 1);
  });

  it("still counts a mention followed by punctuation", () => {
    assert.equal(countMentionOccurrences("ask @Sam Lee, please", "Sam Lee"), 1);
  });

  it("matches regardless of casing", () => {
    assert.equal(countMentionOccurrences("ask @alice ahmed", "Alice Ahmed"), 1);
  });

  it("binds requested ids to actual mentions, dropping the rest", () => {
    assert.deepEqual(
      limitMentionIdsByOccurrences("hi @Bob Osei", [
        { id: ALICE, name: "Alice Ahmed" },
        { id: BOB, name: "Bob Osei" },
      ]),
      [BOB],
    );
  });

  it("drops an id whose mention was deleted from the draft", () => {
    assert.deepEqual(
      limitMentionIdsByOccurrences("no mentions here", [{ id: BOB, name: "Bob Osei" }]),
      [],
    );
  });

  it("drops an id whose mention was extended into a different name", () => {
    assert.deepEqual(
      limitMentionIdsByOccurrences("ask @Sam Leeds", [{ id: BOB, name: "Sam Lee" }]),
      [],
    );
  });

  it("keeps an id whose mention ends with punctuation", () => {
    assert.deepEqual(
      limitMentionIdsByOccurrences("ask @Bob Osei.", [{ id: BOB, name: "Bob Osei" }]),
      [BOB],
    );
    assert.deepEqual(
      limitMentionIdsByOccurrences("use @Bob Osei's draft", [{ id: BOB, name: "Bob Osei" }]),
      [BOB],
    );
  });

  it("caps same-named ids at the occurrence count", () => {
    const sameName = [
      { id: ALICE, name: "Sam Lee" },
      { id: BOB, name: "Sam Lee" },
    ];
    assert.deepEqual(limitMentionIdsByOccurrences("hi @Sam Lee", sameName), [ALICE]);
    assert.deepEqual(limitMentionIdsByOccurrences("@Sam Lee and @Sam Lee", sameName), [ALICE, BOB]);
  });

  it("does not notify a prefix name shadowed by a longer mention", () => {
    // Deleting a selected @Sam while leaving @Sam Lee: the space inside the
    // longer mention must not retain Sam's id.
    const both = [
      { id: ALICE, name: "Sam" },
      { id: BOB, name: "Sam Lee" },
    ];
    assert.deepEqual(limitMentionIdsByOccurrences("ask @Sam Lee", both), [BOB]);
    assert.deepEqual(
      limitMentionIdsByOccurrences("ask @Sam Lee", [...both].reverse()),
      [BOB],
    );
  });

  it("keeps both names when each is genuinely mentioned", () => {
    const both = [
      { id: ALICE, name: "Sam" },
      { id: BOB, name: "Sam Lee" },
    ];
    assert.deepEqual(limitMentionIdsByOccurrences("ask @Sam and @Sam Lee", both), [ALICE, BOB]);
    assert.deepEqual(limitMentionIdsByOccurrences("ask @Sam Lee and @Sam", both), [ALICE, BOB]);
  });
});
