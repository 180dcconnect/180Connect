/**
 * F180 — Admin Dashboard. Pure aggregates for /admin/dashboard.
 *
 * Built directly on top of the team-pipeline data layer (src/lib/admin/team-pipeline.ts)
 * and the CAM dashboard's v1 metric definitions (src/lib/dashboard-metrics.ts).
 * Every function is dependency-free — no Supabase, no Date.now — so `node --test`
 * can exercise it, same reasoning as the other `src/lib/admin/*` modules.
 *
 * Intuition choices (per PM steer 26 Aug):
 * - 30-day growth window kept from CAM dashboard (dashboard-metrics.ts:101), not
 *   shrunk to 14 — pipeline growth is slow, and the last point must equal the
 *   total (organisationGrowthSeries folds pre-window rows in).
 * - Tone performance (F209) excluded from F180 — P3, thin signal until F098 volume.
 *   Show band distribution instead (thresholds high≥0.70/medium≥0.40 pending team
 *   confirmation per 06-predictions.md:33, but the PM approved showing it).
 * - Time-spent (F211) excluded — sensitive, personal, and the spec says "support,
 *   not punitive ranking" (PRD §17:757).
 */

import {
  computeDashboardMetrics,
  organisationGrowthSeries,
  type DashboardMetrics,
  type GrowthPoint,
} from "../dashboard-metrics.ts";
import { pipelineCounts, type StatusCount } from "./team-pipeline.ts";

export type DashboardClient = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string | null;
  owner_name: string | null;
  sector: string | null;
  city: string | null;
  created_at: string;
  updated_at: string;
  priority_score: number | null;
  priority_band: "high" | "medium" | "low" | null;
};

export type FunnelMetrics = DashboardMetrics & {
  /** converted / contacted, 0 when contacted is 0. */
  conversionRate: number;
  /** no_response / contacted */
  noResponseRate: number;
};

export function buildFunnelMetrics(rows: DashboardClient[]): FunnelMetrics {
  const base = computeDashboardMetrics(
    rows as unknown as Parameters<typeof computeDashboardMetrics>[0],
  );
  const contacted = base.contacted;
  const noResponse = rows.filter((r) => r.outreach_status === "no_response").length;
  return {
    ...base,
    conversionRate: contacted === 0 ? 0 : base.converted / contacted,
    noResponseRate: contacted === 0 ? 0 : noResponse / contacted,
  };
}

export type BandCount = { band: "high" | "medium" | "low" | "unscored"; count: number };

/**
 * Distribution of SCOUT priority bands. Latest-scores rows may be missing or
 * have a band outside the three enum values — those count as "unscored".
 * Always sums to rows.length and is returned in high→medium→low→unscored order.
 */
export function bandCounts(rows: DashboardClient[]): BandCount[] {
  const map = new Map<BandCount["band"], number>([
    ["high", 0],
    ["medium", 0],
    ["low", 0],
    ["unscored", 0],
  ]);
  for (const row of rows) {
    const band = row.priority_band;
    if (band === "high" || band === "medium" || band === "low") {
      map.set(band, (map.get(band) ?? 0) + 1);
    } else {
      map.set("unscored", (map.get("unscored") ?? 0) + 1);
    }
  }
  return [
    { band: "high", count: map.get("high") ?? 0 },
    { band: "medium", count: map.get("medium") ?? 0 },
    { band: "low", count: map.get("low") ?? 0 },
    { band: "unscored", count: map.get("unscored") ?? 0 },
  ];
}

export type SectorCount = { sector: string; count: number; avgScore: number | null };

/**
 * Clients per sector, sorted by count desc then sector name. Sectors that are
 * null/blank fold into "Unclassified". avgScore is mean priority_score for that
 * sector (null when no scored row in the slice). Only the top N matter to a
 * manager scanning "where is the pipeline concentrated and how strong is it".
 */
export function sectorCounts(rows: DashboardClient[]): SectorCount[] {
  const bySector = new Map<string, { count: number; scoreSum: number; scoreN: number }>();
  for (const row of rows) {
    const key = row.sector?.trim() || "Unclassified";
    const entry = bySector.get(key) ?? { count: 0, scoreSum: 0, scoreN: 0 };
    entry.count += 1;
    if (typeof row.priority_score === "number" && Number.isFinite(row.priority_score)) {
      entry.scoreSum += row.priority_score;
      entry.scoreN += 1;
    }
    bySector.set(key, entry);
  }
  return [...bySector.entries()]
    .map(([sector, { count, scoreSum, scoreN }]) => ({
      sector,
      count,
      avgScore: scoreN > 0 ? scoreSum / scoreN : null,
    }))
    .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
}

export type OwnerLoad = { ownerId: string | null; ownerName: string; count: number };

export function ownerLoad(rows: DashboardClient[]): OwnerLoad[] {
  const byOwner = new Map<string, { name: string; count: number }>();
  let unassigned = 0;
  for (const row of rows) {
    if (row.owner_id === null) {
      unassigned += 1;
    } else {
      const key = row.owner_id;
      const existing = byOwner.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byOwner.set(key, {
          name: row.owner_name?.trim() || row.owner_id,
          count: 1,
        });
      }
    }
  }
  const loads: OwnerLoad[] = [...byOwner.entries()]
    .map(([ownerId, { name, count }]) => ({ ownerId, ownerName: name, count }))
    .sort((a, b) => b.count - a.count || a.ownerName.localeCompare(b.ownerName));
  if (unassigned > 0) loads.push({ ownerId: null, ownerName: "Unassigned", count: unassigned });
  return loads;
}

// Re-export for dashboard page convenience — the dashboard's "top strip" is the
// same whole-dataset-before-filtering idea that team-pipeline.ts established.
export { pipelineCounts, organisationGrowthSeries };
export type { StatusCount, GrowthPoint };
