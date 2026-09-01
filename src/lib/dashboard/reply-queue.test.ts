import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  awaitingReplyClients,
  replyQueueSummary,
  type QueueOrgRow,
} from "./reply-queue.ts";

const NOW = new Date("2026-09-10T12:00:00Z");
const ME = "user-me";
const THEM = "user-them";

const orgs: QueueOrgRow[] = [
  { id: "org-a", legal_name: "Alpha Trust", owner_id: ME },
  { id: "org-b", legal_name: "Beta Foundation", owner_id: THEM },
  { id: "org-c", legal_name: "Gamma Aid", owner_id: null },
];

describe("awaitingReplyClients", () => {
  it("returns nothing when there are no replies", () => {
    const result = awaitingReplyClients(
      [{ sent_at: "2026-09-01T00:00:00Z", organisation_id: "org-a" }],
      [],
      orgs,
      NOW,
    );
    assert.deepEqual(result, []);
  });

  it("flags a client whose reply is newer than our last send", () => {
    const result = awaitingReplyClients(
      [{ sent_at: "2026-09-01T00:00:00Z", organisation_id: "org-a" }],
      [{ received_at: "2026-09-03T00:00:00Z", organisation_id: "org-a" }],
      orgs,
      NOW,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].organisationId, "org-a");
    assert.equal(result[0].legalName, "Alpha Trust");
    assert.equal(result[0].daysWaiting, 7);
  });

  it("clears a client once we replied after them", () => {
    const result = awaitingReplyClients(
      [
        { sent_at: "2026-09-01T00:00:00Z", organisation_id: "org-a" },
        { sent_at: "2026-09-04T00:00:00Z", organisation_id: "org-a" },
      ],
      [{ received_at: "2026-09-03T00:00:00Z", organisation_id: "org-a" }],
      orgs,
      NOW,
    );
    assert.deepEqual(result, []);
  });

  it("flags a reply on a client we never sent to (a cold inbound)", () => {
    const result = awaitingReplyClients(
      [],
      [{ received_at: "2026-09-09T00:00:00Z", organisation_id: "org-c" }],
      orgs,
      NOW,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].organisationId, "org-c");
  });

  it("uses the newest reply when a client replied twice", () => {
    const result = awaitingReplyClients(
      [{ sent_at: "2026-09-01T00:00:00Z", organisation_id: "org-a" }],
      [
        { received_at: "2026-09-02T00:00:00Z", organisation_id: "org-a" },
        { received_at: "2026-09-08T00:00:00Z", organisation_id: "org-a" },
      ],
      orgs,
      NOW,
    );
    assert.equal(result[0].daysWaiting, 2);
  });

  it("drops organisations absent from the visible set", () => {
    const result = awaitingReplyClients(
      [],
      [{ received_at: "2026-09-09T00:00:00Z", organisation_id: "org-suppressed" }],
      orgs,
      NOW,
    );
    assert.deepEqual(result, []);
  });

  it("ignores a message with a null sent_at rather than treating it as newest", () => {
    const result = awaitingReplyClients(
      [{ sent_at: null, organisation_id: "org-a" }],
      [{ received_at: "2026-09-05T00:00:00Z", organisation_id: "org-a" }],
      orgs,
      NOW,
    );
    assert.equal(result.length, 1);
  });

  it("sorts longest waiting first", () => {
    const result = awaitingReplyClients(
      [],
      [
        { received_at: "2026-09-09T00:00:00Z", organisation_id: "org-a" },
        { received_at: "2026-09-01T00:00:00Z", organisation_id: "org-b" },
      ],
      orgs,
      NOW,
    );
    assert.deepEqual(
      result.map((row) => row.organisationId),
      ["org-b", "org-a"],
    );
  });

  it("never reports a negative wait for a reply timestamped in the future", () => {
    const result = awaitingReplyClients(
      [],
      [{ received_at: "2026-09-20T00:00:00Z", organisation_id: "org-a" }],
      orgs,
      NOW,
    );
    assert.equal(result[0].daysWaiting, 0);
  });
});

describe("replyQueueSummary", () => {
  it("splits team and mine, and reports my longest wait", () => {
    const summary = replyQueueSummary(
      [],
      [
        { received_at: "2026-09-08T00:00:00Z", organisation_id: "org-a" },
        { received_at: "2026-09-02T00:00:00Z", organisation_id: "org-b" },
        { received_at: "2026-09-09T00:00:00Z", organisation_id: "org-c" },
      ],
      orgs,
      ME,
      NOW,
    );
    assert.equal(summary.team, 3);
    assert.equal(summary.mine, 1);
    assert.equal(summary.myOldestDaysWaiting, 2);
    assert.deepEqual(
      summary.myClients.map((row) => row.organisationId),
      ["org-a"],
    );
  });

  it("reports null oldest when none of them are mine", () => {
    const summary = replyQueueSummary(
      [],
      [{ received_at: "2026-09-02T00:00:00Z", organisation_id: "org-b" }],
      orgs,
      ME,
      NOW,
    );
    assert.equal(summary.mine, 0);
    assert.equal(summary.myOldestDaysWaiting, null);
    assert.equal(summary.team, 1);
  });
});
