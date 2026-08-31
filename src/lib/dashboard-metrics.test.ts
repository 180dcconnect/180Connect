import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDashboardMetrics,
  filterActiveSuppressed,
  needsAttention,
  organisationGrowthSeries,
  type DashboardOrgRow,
  type OpenSuppression,
} from "./dashboard-metrics.ts";

function org(overrides: Partial<DashboardOrgRow> = {}): DashboardOrgRow {
  return {
    id: "org-1",
    legal_name: "Test Charity",
    outreach_status: "not_contacted",
    owner_id: null,
    updated_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeDashboardMetrics", () => {
  it("returns all zeros for no data", () => {
    assert.deepEqual(computeDashboardMetrics([]), {
      totalCharities: 0,
      contacted: 0,
      responsesReceived: 0,
      respondingClients: 0,
      converted: 0,
    });
  });

  it("counts total charities regardless of status", () => {
    const rows = [org({ id: "a" }), org({ id: "b" }), org({ id: "c" })];
    assert.equal(computeDashboardMetrics(rows).totalCharities, 3);
  });

  it("counts contacted as anything past not_contacted", () => {
    const rows = [
      org({ id: "a", outreach_status: "not_contacted" }),
      org({ id: "b", outreach_status: "initial_outreach_sent" }),
      org({ id: "c", outreach_status: "converted" }),
    ];
    assert.equal(computeDashboardMetrics(rows).contacted, 2);
  });

  it("counts actual linked reply events rather than inferring replies from status", () => {
    const rows = [org({ id: "a", outreach_status: "responded" })];
    const metrics = computeDashboardMetrics(rows, { totalReplies: 3, respondingClients: 1 });
    assert.equal(metrics.responsesReceived, 3);
    assert.equal(metrics.respondingClients, 1);
  });

  it("counts converted only", () => {
    const rows = [
      org({ id: "a", outreach_status: "converted" }),
      org({ id: "b", outreach_status: "responded" }),
      org({ id: "c", outreach_status: "converted" }),
    ];
    assert.equal(computeDashboardMetrics(rows).converted, 2);
  });

  it("decreases converted count when a client is reverted away from converted (F025 AC3)", () => {
    const beforeRows = [
      org({ id: "a", outreach_status: "converted" }),
      org({ id: "b", outreach_status: "converted" }),
    ];
    assert.equal(computeDashboardMetrics(beforeRows).converted, 2);

    const afterRows = [
      org({ id: "a", outreach_status: "converted" }),
      org({ id: "b", outreach_status: "soft_no" }),
    ];
    assert.equal(computeDashboardMetrics(afterRows).converted, 1);
  });
});

describe("needsAttention", () => {
  it("returns nothing for no data", () => {
    assert.deepEqual(needsAttention([], "cam-1"), []);
  });

  it("excludes clients owned by someone else", () => {
    const rows = [org({ id: "a", owner_id: "cam-2", outreach_status: "follow_up_sent" })];
    assert.deepEqual(needsAttention(rows, "cam-1"), []);
  });

  it("excludes the actor's own clients that aren't stalled", () => {
    const rows = [
      org({ id: "a", owner_id: "cam-1", outreach_status: "not_contacted" }),
      org({ id: "b", owner_id: "cam-1", outreach_status: "converted" }),
    ];
    assert.deepEqual(needsAttention(rows, "cam-1"), []);
  });

  it("includes the actor's own stalled clients, oldest first", () => {
    const rows = [
      org({
        id: "newer",
        owner_id: "cam-1",
        outreach_status: "follow_up_sent",
        legal_name: "Newer Charity",
        updated_at: "2026-02-01T00:00:00Z",
      }),
      org({
        id: "older",
        owner_id: "cam-1",
        outreach_status: "initial_outreach_sent",
        legal_name: "Older Charity",
        updated_at: "2026-01-01T00:00:00Z",
      }),
    ];
    const result = needsAttention(rows, "cam-1");
    assert.deepEqual(
      result.map((item) => item.id),
      ["older", "newer"],
    );
    assert.equal(result[0].legalName, "Older Charity");
    assert.equal(result[0].outreachStatusLabel, "Initial outreach sent");
  });

  it("treats no_response as needing attention", () => {
    const rows = [org({ id: "a", owner_id: "cam-1", outreach_status: "no_response" })];
    assert.equal(needsAttention(rows, "cam-1").length, 1);
  });
});

describe("organisationGrowthSeries", () => {
  const now = new Date("2026-08-15T12:00:00Z");

  it("returns one point per day in the window", () => {
    assert.equal(organisationGrowthSeries([], 30, now).length, 30);
    assert.equal(organisationGrowthSeries([], 7, now).length, 7);
  });

  it("ends on today and starts days-1 back", () => {
    const points = organisationGrowthSeries([], 7, now);
    assert.equal(points[0].date, "2026-08-09");
    assert.equal(points[points.length - 1].date, "2026-08-15");
  });

  it("counts cumulatively, so the last point is the total", () => {
    const rows = [
      org({ id: "a", created_at: "2026-08-10T09:00:00Z" }),
      org({ id: "b", created_at: "2026-08-10T18:00:00Z" }),
      org({ id: "c", created_at: "2026-08-14T09:00:00Z" }),
    ];
    const points = organisationGrowthSeries(rows, 7, now);
    assert.equal(points[0].value, 0); // 09 Aug
    assert.equal(points[1].value, 2); // 10 Aug
    assert.equal(points[4].value, 2); // 13 Aug — no new rows
    assert.equal(points[5].value, 3); // 14 Aug
    assert.equal(points[points.length - 1].value, computeDashboardMetrics(rows).totalCharities);
  });

  it("folds pre-window records into the first point", () => {
    const rows = [
      org({ id: "old", created_at: "2025-01-01T00:00:00Z" }),
      org({ id: "new", created_at: "2026-08-15T00:00:00Z" }),
    ];
    const points = organisationGrowthSeries(rows, 7, now);
    assert.equal(points[0].value, 1);
    assert.equal(points[points.length - 1].value, 2);
  });

  it("keeps rows with an unusable created_at in the total", () => {
    const rows = [org({ id: "a", created_at: "not-a-date" })];
    const points = organisationGrowthSeries(rows, 7, now);
    assert.equal(points[points.length - 1].value, 1);
  });

  it("returns nothing for a zero-day window", () => {
    assert.deepEqual(organisationGrowthSeries([], 0, now), []);
  });
});

describe("filterActiveSuppressed (F022 AC3)", () => {
  it("returns all rows when there are no suppressions", () => {
    const rows = [org({ id: "a" }), org({ id: "b" })];
    assert.deepEqual(filterActiveSuppressed(rows, []), rows);
  });

  it("excludes actively suppressed charities so they do not inflate the outreach pool", () => {
    const rows = [
      org({ id: "a", legal_name: "Active Org" }),
      org({ id: "b", legal_name: "Suppressed Org", outreach_status: "initial_outreach_sent" }),
    ];
    const suppressions: OpenSuppression[] = [{ organisation_id: "b", status: "active" }];

    const activeRows = filterActiveSuppressed(rows, suppressions);
    assert.deepEqual(activeRows.map((r) => r.id), ["a"]);

    const metrics = computeDashboardMetrics(activeRows);
    assert.equal(metrics.totalCharities, 1);
    assert.equal(metrics.contacted, 0);
  });

  it("keeps charities with pending suppression requests counted until approved", () => {
    const rows = [
      org({ id: "a", legal_name: "Active Org" }),
      org({ id: "b", legal_name: "Pending Suppression Org", outreach_status: "responded" }),
    ];
    const suppressions: OpenSuppression[] = [{ organisation_id: "b", status: "pending" }];

    const activeRows = filterActiveSuppressed(rows, suppressions);
    assert.deepEqual(activeRows.map((r) => r.id), ["a", "b"]);

    const metrics = computeDashboardMetrics(activeRows, {
      totalReplies: 1,
      respondingClients: 1,
    });
    assert.equal(metrics.totalCharities, 2);
    assert.equal(metrics.responsesReceived, 1);
  });

  it("excludes actively suppressed charities from needs attention", () => {
    const rows = [
      org({ id: "a", owner_id: "cam-1", outreach_status: "initial_outreach_sent" }),
      org({ id: "b", owner_id: "cam-1", outreach_status: "initial_outreach_sent" }),
    ];
    const suppressions: OpenSuppression[] = [{ organisation_id: "b", status: "active" }];

    const activeRows = filterActiveSuppressed(rows, suppressions);
    const attention = needsAttention(activeRows, "cam-1");
    assert.deepEqual(attention.map((item) => item.id), ["a"]);
  });
});
