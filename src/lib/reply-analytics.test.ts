import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summariseTrackedReplies } from "./reply-analytics.ts";

describe("summariseTrackedReplies (F138)", () => {
  const organisations = [
    { id: "client-a", owner_id: "cam-1" },
    { id: "client-b", owner_id: "cam-1" },
    { id: "client-c", owner_id: "cam-2" },
    { id: "client-d", owner_id: null },
  ];

  it("counts linked replies per client and current CAM owner", () => {
    const summary = summariseTrackedReplies(
      [
        { id: "reply-1", organisation_id: "client-a" },
        { id: "reply-2", organisation_id: "client-a" },
        { id: "reply-3", organisation_id: "client-b" },
        { id: "reply-4", organisation_id: "client-c" },
        { id: "reply-5", organisation_id: "client-d" },
      ],
      organisations,
    );

    assert.equal(summary.totalReplies, 5);
    assert.equal(summary.respondingClients, 4);
    assert.equal(summary.byClient.get("client-a"), 2);
    assert.equal(summary.byCam.get("cam-1"), 3);
    assert.equal(summary.byCam.get("cam-2"), 1);
    assert.equal(summary.unassigned, 1);
  });

  it("does not double-count a duplicate event", () => {
    const duplicate = { id: "reply-1", organisation_id: "client-a" };
    assert.equal(summariseTrackedReplies([duplicate, duplicate], organisations).totalReplies, 1);
  });

  it("does not count an event without a linked client as a successful reply", () => {
    const summary = summariseTrackedReplies(
      [{ id: "unmatched-1", organisation_id: "unknown-client" }],
      organisations,
    );
    assert.equal(summary.totalReplies, 0);
    assert.equal(summary.respondingClients, 0);
  });

  it("returns usable empty analytics when tracking data is missing", () => {
    const summary = summariseTrackedReplies([], organisations);
    assert.equal(summary.totalReplies, 0);
    assert.equal(summary.byClient.size, 0);
    assert.equal(summary.byCam.size, 0);
  });
});
