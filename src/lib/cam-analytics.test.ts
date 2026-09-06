import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DashboardOrgRow } from "./dashboard-metrics.ts";
import { summariseTrackedReplies } from "./reply-analytics.ts";
import {
  compareToTypical,
  computeCamOutreach,
  conversionVsNoResponse,
  describeConversionRatio,
  describeTypicalResponseTime,
  formatConversionRatio,
  MIN_REPLIES_FOR_TYPICAL,
  MIN_SAMPLE_FOR_RATIO,
  myClients,
  slowestClients,
  typicalResponseTime,
  type CamReplyRow,
  type SentMessageRow,
} from "./cam-analytics.ts";

const ME = "cam-me";
const OTHER = "cam-other";

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;

function org(overrides: Partial<DashboardOrgRow> = {}): DashboardOrgRow {
  const id = overrides.id ?? nextId("org");
  return {
    id,
    legal_name: `Charity ${id}`,
    outreach_status: "not_contacted",
    owner_id: ME,
    updated_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function sent(overrides: Partial<SentMessageRow> = {}): SentMessageRow {
  return {
    id: nextId("msg"),
    organisation_id: "org-1",
    sent_by_user_id: ME,
    sent_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function reply(overrides: Partial<CamReplyRow> = {}): CamReplyRow {
  return {
    id: nextId("reply"),
    organisation_id: "org-1",
    response_time_seconds: 3600,
    ...overrides,
  };
}

const NO_REPLIES = { totalReplies: 0, respondingClients: 0 };

describe("myClients (F206)", () => {
  it("keeps only the rows the actor owns", () => {
    const mine = org({ owner_id: ME });
    const theirs = org({ owner_id: OTHER });
    const unowned = org({ owner_id: null });

    assert.deepEqual(myClients([mine, theirs, unowned], ME), [mine]);
  });
});

describe("computeCamOutreach (F206)", () => {
  it("reports zeros and null rates when the CAM owns nothing", () => {
    const totals = computeCamOutreach([], [], NO_REPLIES, ME);

    assert.equal(totals.clientsOwned, 0);
    assert.equal(totals.contacted, 0);
    assert.equal(totals.conversions, 0);
    assert.equal(totals.replyRate, null);
    assert.equal(totals.conversionRate, null);
  });

  it("never returns NaN for a rate when nothing has been contacted", () => {
    const totals = computeCamOutreach([org({ outreach_status: "not_contacted" })], [], NO_REPLIES, ME);

    assert.equal(totals.contacted, 0);
    assert.equal(totals.replyRate, null);
    assert.equal(totals.conversionRate, null);
  });

  it("counts contacted and converted from the shared pipeline predicates", () => {
    const mine = [
      org({ outreach_status: "not_contacted" }),
      org({ outreach_status: "initial_outreach_sent" }),
      org({ outreach_status: "converted" }),
    ];

    const totals = computeCamOutreach(mine, [], NO_REPLIES, ME);

    assert.equal(totals.clientsOwned, 3);
    assert.equal(totals.contacted, 2);
    assert.equal(totals.conversions, 1);
    assert.equal(totals.conversionRate, 0.5);
  });

  it("counts emails sent to my clients whoever pressed send, and splits out the ones I sent", () => {
    const mine = org({ id: "org-mine", outreach_status: "initial_outreach_sent" });
    const messages = [
      sent({ organisation_id: "org-mine", sent_by_user_id: ME }),
      sent({ organisation_id: "org-mine", sent_by_user_id: OTHER }),
      sent({ organisation_id: "org-mine", sent_by_user_id: null }),
    ];

    const totals = computeCamOutreach([mine], messages, NO_REPLIES, ME);

    assert.equal(totals.emailsSent, 3);
    assert.equal(totals.emailsSentByMe, 1);
    assert.equal(totals.emailsSentBeforeHandover, 2);
  });

  it("ignores emails addressed to clients the CAM does not own", () => {
    const mine = org({ id: "org-mine" });
    const messages = [sent({ organisation_id: "org-someone-else", sent_by_user_id: ME })];

    assert.equal(computeCamOutreach([mine], messages, NO_REPLIES, ME).emailsSent, 0);
  });

  it("bases reply rate on responding clients, not on reply messages", () => {
    // One charity replying four times is one responding client, not 400%.
    const mine = [
      org({ id: "org-a", outreach_status: "responded" }),
      org({ id: "org-b", outreach_status: "initial_outreach_sent" }),
    ];
    const replies = summariseTrackedReplies(
      [
        reply({ organisation_id: "org-a" }),
        reply({ organisation_id: "org-a" }),
        reply({ organisation_id: "org-a" }),
        reply({ organisation_id: "org-a" }),
      ],
      mine,
    );

    const totals = computeCamOutreach(mine, [], replies, ME);

    assert.equal(totals.repliesReceived, 4);
    assert.equal(totals.respondingClients, 1);
    assert.equal(totals.replyRate, 0.5);
  });
});

describe("conversionVsNoResponse (F207)", () => {
  it("counts converted and no_response only", () => {
    const ratio = conversionVsNoResponse([
      org({ outreach_status: "converted" }),
      org({ outreach_status: "no_response" }),
      org({ outreach_status: "soft_no" }),
      org({ outreach_status: "hard_no" }),
      org({ outreach_status: "future_potential" }),
      org({ outreach_status: "loss_due_timing" }),
      org({ outreach_status: "responded" }),
    ]);

    assert.equal(ratio.converted, 1);
    assert.equal(ratio.noResponse, 1);
    assert.equal(ratio.total, 2);
  });

  it("divides converted by no-response", () => {
    const ratio = conversionVsNoResponse([
      org({ outreach_status: "converted" }),
      org({ outreach_status: "converted" }),
      org({ outreach_status: "converted" }),
      org({ outreach_status: "no_response" }),
      org({ outreach_status: "no_response" }),
    ]);

    assert.equal(ratio.ratio, 1.5);
    assert.equal(formatConversionRatio(ratio), "1.5 : 1");
  });

  it("returns null rather than Infinity when nothing has gone unanswered", () => {
    const ratio = conversionVsNoResponse([org({ outreach_status: "converted" })]);

    assert.equal(ratio.ratio, null);
    assert.equal(formatConversionRatio(ratio), "All converted");
  });

  it("says so plainly when there are no resolved outcomes at all", () => {
    const ratio = conversionVsNoResponse([org({ outreach_status: "initial_outreach_sent" })]);

    assert.equal(ratio.total, 0);
    assert.equal(ratio.convertedShare, null);
    assert.equal(formatConversionRatio(ratio), "No outcomes yet");
  });

  it("flips hasEnoughData exactly at the threshold", () => {
    const below = Array.from({ length: MIN_SAMPLE_FOR_RATIO - 1 }, () =>
      org({ outreach_status: "no_response" }),
    );
    assert.equal(conversionVsNoResponse(below).hasEnoughData, false);

    const at = [...below, org({ outreach_status: "converted" })];
    assert.equal(conversionVsNoResponse(at).hasEnoughData, true);
  });

  it("always names both raw counts, in both the small-sample and full-sample wordings", () => {
    const small = conversionVsNoResponse([
      org({ outreach_status: "converted" }),
      org({ outreach_status: "no_response" }),
    ]);
    const smallCopy = describeConversionRatio(small);
    assert.match(smallCopy, /1 conversion/);
    assert.match(smallCopy, /1 with no response/);
    assert.match(smallCopy, /too few outcomes/);

    const full = conversionVsNoResponse([
      ...Array.from({ length: 3 }, () => org({ outreach_status: "converted" })),
      ...Array.from({ length: 3 }, () => org({ outreach_status: "no_response" })),
    ]);
    const fullCopy = describeConversionRatio(full);
    assert.match(fullCopy, /3 conversions/);
    assert.match(fullCopy, /3 with no response/);
    assert.doesNotMatch(fullCopy, /too few outcomes/);
  });
});

describe("typicalResponseTime (F208)", () => {
  const times = (...seconds: (number | null | undefined)[]) =>
    seconds.map((value) => reply({ response_time_seconds: value }));

  it("withholds a typical value below the threshold", () => {
    const typical = typicalResponseTime(times(60, 120));

    assert.equal(typical.sampleSize, 2);
    assert.equal(typical.hasEnoughData, false);
    assert.match(describeTypicalResponseTime(typical), /2 of 5 timed replies/);
  });

  it("has enough data at exactly the threshold", () => {
    const typical = typicalResponseTime(
      Array.from({ length: MIN_REPLIES_FOR_TYPICAL }, () => reply({ response_time_seconds: 60 })),
    );

    assert.equal(typical.hasEnoughData, true);
    assert.equal(typical.meanSeconds, 60);
    assert.match(describeTypicalResponseTime(typical), /Based on 5 timed replies/);
  });

  it("excludes untracked, negative and non-finite times from the sample", () => {
    // A null response time means the reply was never timed — not that it arrived
    // instantly. Counting it as zero would drag the mean towards nothing.
    const typical = typicalResponseTime(times(600, null, undefined, -1, Number.NaN));

    assert.equal(typical.sampleSize, 1);
    assert.equal(typical.meanSeconds, 600);
  });

  it("reports the fastest and slowest alongside the mean", () => {
    const typical = typicalResponseTime(times(60, 600, 3600, 120, 240));

    assert.equal(typical.fastestSeconds, 60);
    assert.equal(typical.slowestSeconds, 3600);
    assert.equal(typical.meanSeconds, (60 + 600 + 3600 + 120 + 240) / 5);
  });

  it("returns an empty, explicitly not-enough state when nothing is timed", () => {
    const typical = typicalResponseTime(times(null, null));

    assert.equal(typical.sampleSize, 0);
    assert.equal(typical.meanSeconds, null);
    assert.equal(typical.hasEnoughData, false);
  });
});

describe("compareToTypical and slowestClients (F208 AC3)", () => {
  it("treats anything within the tolerance band as about typical", () => {
    assert.equal(compareToTypical(100, 100), "typical");
    assert.equal(compareToTypical(120, 100), "typical");
    assert.equal(compareToTypical(80, 100), "typical");
    assert.equal(compareToTypical(126, 100), "slower");
    assert.equal(compareToTypical(74, 100), "faster");
  });

  it("does not divide by a mean of zero", () => {
    assert.equal(compareToTypical(10, 0), "typical");
  });

  it("lists the CAM's slowest clients first and respects the limit", () => {
    const mine = [
      org({ id: "org-fast" }),
      org({ id: "org-slow" }),
      org({ id: "org-middling" }),
    ];
    const byClient = new Map([
      ["org-fast", { averageSeconds: 60 }],
      ["org-slow", { averageSeconds: 86_400 }],
      ["org-middling", { averageSeconds: 3600 }],
    ]);
    const typical = typicalResponseTime(
      Array.from({ length: 5 }, () => reply({ response_time_seconds: 3600 })),
    );

    const listed = slowestClients(mine, byClient, typical, 2);

    assert.deepEqual(
      listed.map((client) => client.id),
      ["org-slow", "org-middling"],
    );
    assert.equal(listed[0].comparison, "slower");
    assert.equal(listed[1].comparison, "typical");
    assert.match(listed[0].label, /slower than typical/);
  });

  it("only ever lists clients the CAM owns", () => {
    const mine = [org({ id: "org-mine" })];
    const byClient = new Map([
      ["org-mine", { averageSeconds: 60 }],
      ["org-theirs", { averageSeconds: 86_400 }],
    ]);
    const typical = typicalResponseTime(
      Array.from({ length: 5 }, () => reply({ response_time_seconds: 3600 })),
    );

    assert.deepEqual(
      slowestClients(mine, byClient, typical).map((client) => client.id),
      ["org-mine"],
    );
  });

  it("draws no comparisons against a typical value we have said not to trust", () => {
    const mine = [org({ id: "org-mine" })];
    const byClient = new Map([["org-mine", { averageSeconds: 60 }]]);
    const typical = typicalResponseTime([reply({ response_time_seconds: 3600 })]);

    assert.equal(typical.hasEnoughData, false);
    assert.deepEqual(slowestClients(mine, byClient, typical), []);
  });
});
