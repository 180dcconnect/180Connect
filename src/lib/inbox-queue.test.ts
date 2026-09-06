import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildInboxQueue,
  countByBucket,
  countByScope,
  daysSince,
  filterByBucket,
  filterByScope,
  parseBucket,
  parseScope,
  type InboxQueueRow,
} from "./inbox-queue.ts";
import type { FollowUpRecommendation } from "./outreach/follow-up-recommendations.ts";
import type { InboxThread, InboxThreadStatus } from "./outreach-inbox.ts";

const NOW = new Date("2026-09-06T12:00:00Z");
const ACTOR = "user-cam";

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  const orgId = overrides.orgId ?? "org-1";
  return {
    orgId,
    orgName: overrides.orgName ?? "Oxfam GB",
    href: `/inbox/${orgId}`,
    lastActivityAt: overrides.lastActivityAt ?? "2026-09-05T12:00:00Z",
    lastActorName: overrides.lastActorName ?? "Ada Lovelace",
    lastEventLabel: overrides.lastEventLabel ?? "Email sent",
    subject: overrides.subject ?? "Partnership with 180DC Sheffield",
    snippet: overrides.snippet ?? "Following up on our note last month.",
    status: overrides.status ?? ("sent" as InboxThreadStatus),
    replyIntent: overrides.replyIntent ?? null,
    messageCount: overrides.messageCount ?? 1,
    relativeTime: overrides.relativeTime ?? "1 day ago",
    isRecent: overrides.isRecent ?? false,
  };
}

function recommendation(
  overrides: Partial<FollowUpRecommendation> = {},
): FollowUpRecommendation {
  return {
    organisationId: overrides.organisationId ?? "org-1",
    legalName: overrides.legalName ?? "Oxfam GB",
    statusLabel: overrides.statusLabel ?? "Initial outreach sent",
    lastActivityAt: overrides.lastActivityAt ?? "2026-08-20T12:00:00Z",
    daysWaiting: overrides.daysWaiting ?? 17,
    urgency: overrides.urgency ?? "due",
  };
}

describe("daysSince", () => {
  it("floors whole days and never goes negative", () => {
    assert.equal(daysSince("2026-09-05T12:00:00Z", NOW), 1);
    assert.equal(daysSince("2026-09-05T12:00:01Z", NOW), 0);
    assert.equal(daysSince("2026-09-30T12:00:00Z", NOW), 0);
  });

  it("treats an unparseable timestamp as no wait rather than NaN", () => {
    assert.equal(daysSince("not-a-date", NOW), 0);
  });
});

describe("buildInboxQueue", () => {
  it("puts a client reply in needs_reply, whatever else is true of it", () => {
    const rows = buildInboxQueue(
      [thread({ status: "replied", replyIntent: "interested" })],
      new Map([["org-1", ACTOR]]),
      // A reply outranks a follow-up prompt: answering beats chasing.
      [recommendation()],
      ACTOR,
      NOW,
    );
    assert.equal(rows[0].bucket, "needs_reply");
    assert.equal(rows[0].followUpUrgency, "due");
  });

  it("buckets a quiet thread by whether F160 recommends a follow-up", () => {
    const rows = buildInboxQueue(
      [
        thread({ orgId: "org-1", orgName: "Oxfam GB" }),
        thread({ orgId: "org-2", orgName: "Shelter" }),
      ],
      new Map(),
      [recommendation({ organisationId: "org-2", legalName: "Shelter" })],
      ACTOR,
      NOW,
    );
    const byOrg = new Map(rows.map((row) => [row.orgId, row]));
    assert.equal(byOrg.get("org-2")?.bucket, "follow_up_due");
    assert.equal(byOrg.get("org-1")?.bucket, "awaiting_them");
    assert.equal(byOrg.get("org-1")?.followUpUrgency, null);
  });

  it("marks ownership, treating an unowned client as not mine", () => {
    const rows = buildInboxQueue(
      [
        thread({ orgId: "org-1" }),
        thread({ orgId: "org-2" }),
        thread({ orgId: "org-3" }),
      ],
      new Map([
        ["org-1", ACTOR],
        ["org-2", "user-other"],
        ["org-3", null],
      ]),
      [],
      ACTOR,
      NOW,
    );
    const byOrg = new Map(rows.map((row) => [row.orgId, row]));
    assert.equal(byOrg.get("org-1")?.isMine, true);
    assert.equal(byOrg.get("org-2")?.isMine, false);
    assert.equal(byOrg.get("org-3")?.isMine, false);
    assert.equal(byOrg.get("org-3")?.ownerId, null);
  });

  it("orders by bucket, then urgency, then longest wait", () => {
    const rows = buildInboxQueue(
      [
        thread({ orgId: "quiet", orgName: "Quiet", lastActivityAt: "2026-09-01T12:00:00Z" }),
        thread({ orgId: "due", orgName: "Due", lastActivityAt: "2026-08-30T12:00:00Z" }),
        thread({ orgId: "urgent", orgName: "Urgent", lastActivityAt: "2026-08-25T12:00:00Z" }),
        thread({ orgId: "fresh-reply", orgName: "Fresh reply", status: "replied", lastActivityAt: "2026-09-06T09:00:00Z" }),
        thread({ orgId: "old-reply", orgName: "Old reply", status: "replied", lastActivityAt: "2026-08-01T12:00:00Z" }),
      ],
      new Map(),
      [
        recommendation({ organisationId: "due", urgency: "due" }),
        recommendation({ organisationId: "urgent", urgency: "urgent" }),
      ],
      ACTOR,
      NOW,
    );
    assert.deepEqual(
      rows.map((row) => row.orgId),
      // Replies first and the oldest reply above the fresh one — a reply gets
      // more urgent as it ages, not less.
      ["old-reply", "fresh-reply", "urgent", "due", "quiet"],
    );
  });

  it("returns every thread it is given", () => {
    const rows = buildInboxQueue(
      [thread({ orgId: "org-1" }), thread({ orgId: "org-2" })],
      new Map(),
      [],
      ACTOR,
      NOW,
    );
    assert.equal(rows.length, 2);
  });

  it("handles an empty queue", () => {
    assert.deepEqual(buildInboxQueue([], new Map(), [], ACTOR, NOW), []);
  });
});

describe("filtering and counting", () => {
  const rows: InboxQueueRow[] = buildInboxQueue(
    [
      thread({ orgId: "org-1", orgName: "Mine replied", status: "replied" }),
      thread({ orgId: "org-2", orgName: "Mine quiet" }),
      thread({ orgId: "org-3", orgName: "Theirs quiet" }),
      thread({ orgId: "org-4", orgName: "Unowned quiet" }),
    ],
    new Map([
      ["org-1", ACTOR],
      ["org-2", ACTOR],
      ["org-3", "user-other"],
      ["org-4", null],
    ]),
    [recommendation({ organisationId: "org-3" })],
    ACTOR,
    NOW,
  );

  it("splits mine from team, with unowned counted as team", () => {
    assert.deepEqual(filterByScope(rows, "mine").map((r) => r.orgId), ["org-1", "org-2"]);
    assert.deepEqual(filterByScope(rows, "team").map((r) => r.orgId).sort(), ["org-3", "org-4"]);
    assert.equal(filterByScope(rows, "all").length, 4);
  });

  it("counts scopes so the numbers add up", () => {
    const counts = countByScope(rows);
    assert.deepEqual(counts, { mine: 2, team: 2, all: 4 });
  });

  it("counts buckets within whatever is on screen", () => {
    assert.deepEqual(countByBucket(filterByScope(rows, "mine")), {
      needs_reply: 1,
      follow_up_due: 0,
      awaiting_them: 1,
      all: 2,
    });
  });

  it("filters by bucket, and a null bucket means no filter", () => {
    assert.deepEqual(filterByBucket(rows, "needs_reply").map((r) => r.orgId), ["org-1"]);
    assert.equal(filterByBucket(rows, null).length, 4);
  });
});

describe("search param parsing", () => {
  it("defaults an absent or unknown scope to mine", () => {
    assert.equal(parseScope(undefined), "mine");
    assert.equal(parseScope("everyone"), "mine");
    assert.equal(parseScope("team"), "team");
    assert.equal(parseScope("all"), "all");
  });

  it("treats an absent or unknown bucket as no filter", () => {
    assert.equal(parseBucket(undefined), null);
    assert.equal(parseBucket("starred"), null);
    assert.equal(parseBucket("needs_reply"), "needs_reply");
  });
});
