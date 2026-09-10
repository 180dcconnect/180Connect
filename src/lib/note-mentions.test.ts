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
  filterMentionCandidates,
  groupBulkClientsByOwner,
  mentionQueryAtCursor,
  noteNotificationLinkPath,
  ownerAlreadyMentioned,
  resolveMentionRecipientIds,
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

describe("resolveMentionRecipientIds (F485 mention half)", () => {
  it("passes through a single mention", () => {
    assert.deepEqual(resolveMentionRecipientIds([BOB], ALICE), [BOB]);
  });

  it("dedupes a repeated mention of the same user", () => {
    assert.deepEqual(resolveMentionRecipientIds([BOB, BOB, BOB], ALICE), [BOB]);
  });

  it("keeps multiple distinct mentions", () => {
    assert.deepEqual(resolveMentionRecipientIds([BOB, CAROL], ALICE), [BOB, CAROL]);
  });

  it("drops the author — the author is never notified about their own note", () => {
    assert.deepEqual(resolveMentionRecipientIds([ALICE, BOB], ALICE), [BOB]);
    assert.deepEqual(resolveMentionRecipientIds([ALICE], ALICE), []);
  });

  it("drops malformed ids rather than throwing", () => {
    assert.deepEqual(
      resolveMentionRecipientIds(["not-a-uuid", null, 42, BOB], ALICE),
      [BOB],
    );
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
