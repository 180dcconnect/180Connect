import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  averageResponseTime,
  formatResponseTime,
  summariseTrackedReplies,
} from "./reply-analytics.ts";

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
    assert.equal(summary.averageResponseTimeSeconds, null);
  });

  it("aggregates one stored response time per outreach attempt", () => {
    const summary = summariseTrackedReplies(
      [
        { id: "reply-1", organisation_id: "client-a", response_time_seconds: 3600 },
        { id: "reply-2", organisation_id: "client-a", response_time_seconds: null },
        { id: "reply-3", organisation_id: "client-b", response_time_seconds: 1800 },
      ],
      organisations,
    );
    assert.equal(summary.averageResponseTimeSeconds, 2700);
    assert.deepEqual(summary.responseTimeByClient.get("client-a"), {
      attempts: 1,
      totalSeconds: 3600,
      averageSeconds: 3600,
    });
    assert.deepEqual(summary.responseTimeByCam.get("cam-1"), {
      attempts: 2,
      totalSeconds: 5400,
      averageSeconds: 2700,
    });
  });
});

describe("response-time display", () => {
  it("ignores missing and invalid tracking data when averaging", () => {
    assert.equal(averageResponseTime([
      { response_time_seconds: 60 },
      { response_time_seconds: null },
      { response_time_seconds: -1 },
      { response_time_seconds: 180 },
    ]), 120);
  });

  it("formats minutes, hours, and days for analytics display", () => {
    assert.equal(formatResponseTime(30 * 60), "30 min");
    assert.equal(formatResponseTime(90 * 60), "1 hr 30 min");
    assert.equal(formatResponseTime(49 * 60 * 60), "2 days 1 hr");
    assert.equal(formatResponseTime(null), "Not available");
  });
});
