import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandCounts,
  buildFunnelMetrics,
  ownerLoad,
  sectorCounts,
} from "./dashboard-metrics.ts";
import type { DashboardClient } from "./dashboard-metrics.ts";

function client(overrides: Partial<DashboardClient> = {}): DashboardClient {
  return {
    id: "1",
    legal_name: "Acme",
    outreach_status: "not_contacted",
    owner_id: null,
    owner_name: null,
    sector: null,
    city: null,
    created_at: "2026-08-10T10:00:00Z",
    updated_at: "2026-08-10T10:00:00Z",
    priority_score: null,
    priority_band: null,
    ...overrides,
  };
}

describe("buildFunnelMetrics", () => {
  it("counts funnel stages and rates off outreach_status", () => {
    const rows = [
      client({ outreach_status: "not_contacted" }),
      client({ id: "2", outreach_status: "initial_outreach_sent" }),
      client({ id: "3", outreach_status: "converted" }),
      client({ id: "4", outreach_status: "no_response" }),
    ];
    const m = buildFunnelMetrics(rows);
    assert.equal(m.totalCharities, 4);
    assert.equal(m.contacted, 3);
    assert.equal(m.converted, 1);
    assert.equal(m.conversionRate, 1 / 3);
    assert.equal(m.noResponseRate, 1 / 3);
  });

  it("returns 0 rates when nothing contacted", () => {
    const m = buildFunnelMetrics([client()]);
    assert.equal(m.conversionRate, 0);
    assert.equal(m.noResponseRate, 0);
  });
});

describe("bandCounts", () => {
  it("buckets high/medium/low/unscored and always sums", () => {
    const rows = [
      client({ id: "1", priority_band: "high" }),
      client({ id: "2", priority_band: "high" }),
      client({ id: "3", priority_band: "medium" }),
      client({ id: "4", priority_band: null }),
      client({ id: "5", priority_band: null }),
    ];
    const counts = bandCounts(rows);
    assert.deepEqual(counts, [
      { band: "high", count: 2 },
      { band: "medium", count: 1 },
      { band: "low", count: 0 },
      { band: "unscored", count: 2 },
    ]);
    assert.equal(counts.reduce((a, b) => a + b.count, 0), rows.length);
  });
});

describe("sectorCounts", () => {
  it("groups by sector, Unclassified for blank, sorts by count desc", () => {
    const rows = [
      client({ id: "1", sector: "Health", priority_score: 0.8 }),
      client({ id: "2", sector: "Health", priority_score: 0.6 }),
      client({ id: "3", sector: "Education" }),
      client({ id: "4", sector: null }),
      client({ id: "5", sector: "   " }),
    ];
    const counts = sectorCounts(rows);
    assert.equal(counts[0].sector, "Health");
    assert.equal(counts[0].count, 2);
    assert.equal(counts[0].avgScore?.toFixed(2), "0.70");
    // Health and Unclassified tie at 2 — alphabetical puts Health first
    assert.equal(counts[1].sector, "Unclassified");
    assert.equal(counts[1].count, 2);
    assert.equal(counts[2].sector, "Education");
  });

  it("returns null avgScore when no scored row in sector", () => {
    const counts = sectorCounts([client({ sector: "Health" })]);
    assert.equal(counts[0].avgScore, null);
  });
});

describe("ownerLoad", () => {
  it("counts per CAM and appends Unassigned last", () => {
    const rows = [
      client({ id: "1", owner_id: "cam-a", owner_name: "Ada" }),
      client({ id: "2", owner_id: "cam-a", owner_name: "Ada" }),
      client({ id: "3", owner_id: "cam-b", owner_name: "Bo" }),
      client({ id: "4", owner_id: null }),
    ];
    const loads = ownerLoad(rows);
    assert.deepEqual(loads, [
      { ownerId: "cam-a", ownerName: "Ada", count: 2 },
      { ownerId: "cam-b", ownerName: "Bo", count: 1 },
      { ownerId: null, ownerName: "Unassigned", count: 1 },
    ]);
  });

  it("falls back to owner_id when name is blank", () => {
    const loads = ownerLoad([client({ owner_id: "cam-x", owner_name: "  " })]);
    assert.equal(loads[0].ownerName, "cam-x");
  });

  it("omits Unassigned when none exist", () => {
    const loads = ownerLoad([client({ owner_id: "cam-a", owner_name: "Ada" })]);
    assert.equal(loads.length, 1);
  });
});
