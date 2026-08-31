import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computePerformance,
  pipelineTrendSeries,
  queueBands,
  sectorPerformance,
  weekWindows,
  type ConvertedOutcomeRow,
  type LatestScoreRow,
  type PerformanceInput,
  type ReplyEventRow,
  type SentMessageRow,
  type TeamUserRow,
} from "./performance-metrics.ts";

// A fixed "now": Wednesday 12 August 2026, 12:00 UTC. The ISO week runs
// Mon 10 Aug 00:00 → Mon 17 Aug 00:00; last week Mon 3 → Mon 10 Aug.
const NOW = new Date("2026-08-12T12:00:00Z");

function message(overrides: Partial<SentMessageRow> = {}): SentMessageRow {
  return {
    id: "msg-1",
    sent_at: "2026-08-11T10:00:00Z",
    sent_by_user_id: "cam-1",
    organisation_id: "org-1",
    ...overrides,
  };
}

function reply(overrides: Partial<ReplyEventRow> = {}): ReplyEventRow {
  return {
    id: "rep-1",
    received_at: "2026-08-11T16:00:00Z",
    outreach_message_id: "msg-1",
    organisation_id: "org-1",
    ...overrides,
  };
}

function conversion(overrides: Partial<ConvertedOutcomeRow> = {}): ConvertedOutcomeRow {
  return {
    id: "out-1",
    created_at: "2026-08-11T17:00:00Z",
    recorded_by_user_id: "cam-1",
    organisation_id: "org-1",
    ...overrides,
  };
}

function score(overrides: Partial<LatestScoreRow> = {}): LatestScoreRow {
  return {
    organisation_id: "org-1",
    priority_band: "high",
    priority_score: 0.8,
    scored_at: "2026-08-11T08:00:00Z",
    ...overrides,
  };
}

const USERS: TeamUserRow[] = [
  { id: "cam-1", full_name: "Ada Lovelace", role: "cam" },
  { id: "cam-2", full_name: "Grace Hopper", role: "cam" },
  { id: "admin-1", full_name: "Alan Turing", role: "admin" },
];

function input(overrides: Partial<PerformanceInput> = {}): PerformanceInput {
  return {
    messages: [],
    replies: [],
    conversions: [],
    scores: [],
    users: USERS,
    ...overrides,
  };
}

describe("weekWindows", () => {
  it("cuts Monday-start ISO weeks (UTC), end exclusive", () => {
    const { thisWeek, lastWeek } = weekWindows(NOW);
    assert.equal(new Date(thisWeek.start).toISOString(), "2026-08-10T00:00:00.000Z");
    assert.equal(new Date(thisWeek.end).toISOString(), "2026-08-17T00:00:00.000Z");
    assert.equal(new Date(lastWeek.start).toISOString(), "2026-08-03T00:00:00.000Z");
    assert.equal(new Date(lastWeek.end).toISOString(), "2026-08-10T00:00:00.000Z");
  });

  it("folds a Sunday back into the week that Monday opened", () => {
    // Sunday 16 Aug belongs to the Mon 10 – Mon 17 week.
    const { thisWeek } = weekWindows(new Date("2026-08-16T23:59:00Z"));
    assert.equal(new Date(thisWeek.start).toISOString(), "2026-08-10T00:00:00.000Z");
  });
});

describe("computePerformance", () => {
  it("counts team totals this week vs last week", () => {
    const summary = computePerformance(
      input({
        messages: [
          message(), // this week
          message({ id: "msg-2", sent_at: "2026-08-05T10:00:00Z" }), // last week
          message({ id: "msg-3", sent_at: "2026-07-20T10:00:00Z" }), // outside both
        ],
        replies: [
          reply(), // this week
          reply({ id: "rep-2", received_at: "2026-08-06T09:00:00Z", outreach_message_id: "msg-2" }), // last week
        ],
        conversions: [
          conversion(), // this week
          conversion({ id: "out-2", created_at: "2026-08-04T09:00:00Z" }), // last week
        ],
        scores: [
          score(), // scored this week
          score({ organisation_id: "org-2", scored_at: "2026-08-06T08:00:00Z" }), // last week
        ],
      }),
      NOW,
    );
    assert.deepEqual(summary.team.emailsSent, { thisWeek: 1, lastWeek: 1 });
    assert.deepEqual(summary.team.replies, { thisWeek: 1, lastWeek: 1 });
    assert.deepEqual(summary.team.conversions, { thisWeek: 1, lastWeek: 1 });
    assert.deepEqual(summary.orgsScored, { thisWeek: 1, lastWeek: 1 });
  });

  it("attributes replies to the sender of the message they answer", () => {
    const summary = computePerformance(
      input({
        messages: [
          message({ sent_by_user_id: "cam-1" }),
          message({ id: "msg-2", sent_at: "2026-08-11T09:00:00Z", sent_by_user_id: "cam-2" }),
        ],
        replies: [
          reply({ outreach_message_id: "msg-1" }),
          reply({ id: "rep-2", outreach_message_id: "msg-2" }),
        ],
      }),
      NOW,
    );
    assert.equal(summary.people.get("cam-1")?.replies.thisWeek, 1);
    assert.equal(summary.people.get("cam-2")?.replies.thisWeek, 1);
    assert.equal(summary.team.replies.thisWeek, 2);
  });

  it("drops unmatched replies from person counts (cannot attribute them)", () => {
    const summary = computePerformance(
      input({
        messages: [message()],
        replies: [
          reply({ outreach_message_id: null }),
          reply({ id: "rep-2", outreach_message_id: "msg-999" }), // message not fetched
        ],
      }),
      NOW,
    );
    assert.equal(summary.team.replies.thisWeek, 0);
    // The sent email still attributes to cam-1, but no reply lands on anyone.
    assert.equal(summary.people.get("cam-1")?.replies.thisWeek, 0);
    assert.equal(summary.people.get("cam-1")?.emailsSent.thisWeek, 1);
  });

  it("keeps per-person rollups separate from team totals", () => {
    const summary = computePerformance(
      input({
        messages: [
          message({ sent_by_user_id: "cam-1" }),
          message({ id: "msg-2", sent_by_user_id: "admin-1" }),
        ],
      }),
      NOW,
    );
    assert.equal(summary.people.get("cam-1")?.emailsSent.thisWeek, 1);
    assert.equal(summary.people.get("admin-1")?.emailsSent.thisWeek, 1);
    assert.equal(summary.team.emailsSent.thisWeek, 2);
  });

  it("names unknown senders defensively", () => {
    const summary = computePerformance(
      input({ messages: [message({ sent_by_user_id: "ghost" })], users: [] }),
      NOW,
    );
    assert.equal(summary.people.get("ghost")?.name, "Unknown");
  });
});

describe("pipelineTrendSeries", () => {
  it("returns one point per day with cumulative conversion rate", () => {
    const series = pipelineTrendSeries(
      input({
        messages: [
          message({ sent_at: "2026-08-01T10:00:00Z", organisation_id: "org-1" }),
          message({ id: "msg-2", sent_at: "2026-08-03T10:00:00Z", organisation_id: "org-2" }),
        ],
        conversions: [conversion({ created_at: "2026-08-05T10:00:00Z" })],
      }),
      90,
      NOW,
    );
    assert.equal(series.length, 90);
    // By 1 Aug: 1 contacted, 0 converted → 0.
    const aug1 = series.find((p) => p.date === "2026-08-01");
    assert.equal(aug1?.value, 0);
    // By 3 Aug: 2 contacted, 0 converted → 0.
    const aug3 = series.find((p) => p.date === "2026-08-03");
    assert.equal(aug3?.value, 0);
    // By 5 Aug: 2 contacted, 1 converted → 0.5.
    const aug5 = series.find((p) => p.date === "2026-08-05");
    assert.equal(aug5?.value, 0.5);
    // The last point carries the cumulative state forward.
    assert.equal(series[series.length - 1].value, 0.5);
  });

  it("scores 0 on days before any contact rather than dividing by zero", () => {
    const series = pipelineTrendSeries(input({}), 7, NOW);
    assert.equal(series.length, 7);
    for (const point of series) assert.equal(point.value, 0);
  });

  it("counts each organisation once even with many messages", () => {
    const series = pipelineTrendSeries(
      input({
        messages: [
          message({ sent_at: "2026-08-07T10:00:00Z" }),
          message({ id: "msg-2", sent_at: "2026-08-08T10:00:00Z" }), // same org again
        ],
        conversions: [conversion({ created_at: "2026-08-08T10:00:00Z" })],
      }),
      7,
      NOW,
    );
    const last = series[series.length - 1].value;
    // 1 contacted org, 1 converted org → rate 1, not 1/2.
    assert.equal(last, 1);
  });
});

describe("sectorPerformance", () => {
  const sectorByOrg = new Map([
    ["org-1", "Environment"],
    ["org-2", "Education"],
    ["org-3", null],
  ]);

  it("rolls reply and conversion rates up per sector", () => {
    const rows = sectorPerformance(
      input({
        messages: [
          message({ organisation_id: "org-1" }),
          message({ id: "msg-2", sent_at: "2026-08-11T11:00:00Z", organisation_id: "org-1" }),
          message({ id: "msg-3", sent_at: "2026-08-11T12:00:00Z", organisation_id: "org-2" }),
        ],
        replies: [
          reply({ organisation_id: "org-1" }),
          reply({ id: "rep-2", organisation_id: "org-2" }),
        ],
        conversions: [conversion({ organisation_id: "org-1" })],
        scores: [
          score({ organisation_id: "org-1", priority_score: 0.8 }),
          score({ organisation_id: "org-2", priority_band: "low", priority_score: 0.2 }),
        ],
      }),
      sectorByOrg,
      90,
      NOW,
    );

    const environment = rows.find((row) => row.sector === "Environment");
    assert.ok(environment);
    assert.equal(environment.orgsContacted, 1);
    assert.equal(environment.emailsSent, 2);
    assert.equal(environment.replies, 1);
    assert.equal(environment.replyRate, 0.5); // 1 reply ÷ 2 emails
    assert.equal(environment.conversionRate, 1); // 1 converted ÷ 1 contacted org
    assert.equal(environment.avgPriorityScore, 0.8);

    const education = rows.find((row) => row.sector === "Education");
    assert.ok(education);
    assert.equal(education.replyRate, 1); // 1 reply ÷ 1 email
    assert.equal(education.conversionRate, 0);
    assert.equal(education.avgPriorityScore, 0.2);
  });

  it("buckets orgs with no sector under 'Unknown sector'", () => {
    const rows = sectorPerformance(
      input({ messages: [message({ organisation_id: "org-3" })] }),
      sectorByOrg,
      90,
      NOW,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sector, "Unknown sector");
  });

  it("sorts by conversion rate, then volume", () => {
    const rows = sectorPerformance(
      input({
        messages: [
          message({ organisation_id: "org-1" }),
          message({ id: "msg-2", sent_at: "2026-08-11T11:00:00Z", organisation_id: "org-2" }),
          message({ id: "msg-3", sent_at: "2026-08-11T12:00:00Z", organisation_id: "org-2" }),
        ],
        conversions: [conversion({ organisation_id: "org-1" })],
      }),
      sectorByOrg,
      90,
      NOW,
    );
    // Environment converts (1.0) before Education (0), even though Education
    // sent more emails.
    assert.deepEqual(
      rows.map((row) => row.sector),
      ["Environment", "Education"],
    );
  });
});

describe("queueBands", () => {
  it("counts the three bands and the scored total", () => {
    const { bands, scored } = queueBands([
      score({ organisation_id: "org-1", priority_band: "high" }),
      score({ organisation_id: "org-2", priority_band: "medium" }),
      score({ organisation_id: "org-3", priority_band: "medium" }),
      score({ organisation_id: "org-4", priority_band: "low" }),
    ]);
    assert.deepEqual(bands, { high: 1, medium: 2, low: 1 });
    assert.equal(scored, 4);
  });

  it("ignores null-band rows defensively", () => {
    const { bands, scored } = queueBands([
      score({ priority_band: null }),
      score({ organisation_id: "org-2", priority_band: "high" }),
    ]);
    assert.deepEqual(bands, { high: 1, medium: 0, low: 0 });
    assert.equal(scored, 1);
  });

  it("returns zeros for an empty queue", () => {
    const { bands, scored } = queueBands([]);
    assert.deepEqual(bands, { high: 0, medium: 0, low: 0 });
    assert.equal(scored, 0);
  });
});
