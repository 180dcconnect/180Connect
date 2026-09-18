import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { reportError } from "../error-logging.ts";
import { createAdminClient } from "../supabase/admin.ts";
import { findBackfillTargets } from "./annual-return-backfill.ts";
import { findCompanyNumberTargets } from "./company-number-backfill.ts";
import { loadCharityIdentifiers } from "./coverage-reads.ts";
import { findProfileTargets } from "./profile-backfill.ts";
import { findReachTargets } from "./reach-backfill.ts";

export const COVERAGE_KINDS = [
  "annual_return",
  "profile",
  "reach",
  "company_number",
] as const;

export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export type CoverageSnapshot = {
  coverageKind: CoverageKind;
  charities: number | null;
  covered: number | null;
  pending: number | null;
  pendingItems: number | null;
  registerBuiltOn: string | null;
  calculatedAt: string | null;
  staleAt: string | null;
  refreshStartedAt: string | null;
};

type CoverageSnapshotRow = {
  coverage_kind: string;
  charities: number | null;
  covered: number | null;
  pending: number | null;
  pending_items: number | null;
  register_built_on: string | null;
  calculated_at: string | null;
  stale_at: string | null;
  refresh_started_at: string | null;
};

export type CoverageSnapshotRead =
  | { available: true; snapshots: Map<CoverageKind, CoverageSnapshot> }
  | { available: false; error: unknown; migrationMissing: boolean };

/**
 * The page's entire coverage read: four rows, one request, no local-register
 * lookups. `available: false` deliberately preserves the former live path
 * during a rolling deployment where application code can arrive before its
 * additive migration.
 */
export async function readCoverageSnapshots(
  supabase: SupabaseClient,
): Promise<CoverageSnapshotRead> {
  const { data, error } = await supabase
    .from("charity_register_coverage")
    .select(
      "coverage_kind, charities, covered, pending, pending_items, " +
        "register_built_on, calculated_at, stale_at, refresh_started_at",
    )
    .returns<CoverageSnapshotRow[]>();

  if (error) {
    return {
      available: false,
      error,
      migrationMissing: isMissingRelationError(error),
    };
  }

  const snapshots = new Map<CoverageKind, CoverageSnapshot>();
  for (const row of data ?? []) {
    if (!isCoverageKind(row.coverage_kind)) continue;
    snapshots.set(row.coverage_kind, {
      coverageKind: row.coverage_kind,
      charities: row.charities,
      covered: row.covered,
      pending: row.pending,
      pendingItems: row.pending_items,
      registerBuiltOn: row.register_built_on,
      calculatedAt: row.calculated_at,
      staleAt: row.stale_at,
      refreshStartedAt: row.refresh_started_at,
    });
  }
  return { available: true, snapshots };
}

export function coverageSnapshotsNeedRefresh(
  snapshots: ReadonlyMap<CoverageKind, CoverageSnapshot>,
  registerBuiltOn: string,
): boolean {
  return COVERAGE_KINDS.some((kind) => {
    const snapshot = snapshots.get(kind);
    return (
      !snapshot ||
      snapshot.calculatedAt === null ||
      snapshot.staleAt !== null ||
      snapshot.registerBuiltOn !== registerBuiltOn
    );
  });
}

const REFRESH_LEASE_MS = 10 * 60 * 1_000;

/** True when work remains and at least one row is not held by a live worker. */
export function coverageRefreshShouldStart(
  snapshots: ReadonlyMap<CoverageKind, CoverageSnapshot>,
  registerBuiltOn: string,
  nowMs: number,
): boolean {
  return COVERAGE_KINDS.some((kind) => {
    const snapshot = snapshots.get(kind);
    const stale =
      !snapshot ||
      snapshot.calculatedAt === null ||
      snapshot.staleAt !== null ||
      snapshot.registerBuiltOn !== registerBuiltOn;
    if (!stale) return false;
    if (!snapshot?.refreshStartedAt) return true;
    const startedAt = new Date(snapshot.refreshStartedAt).getTime();
    return !Number.isFinite(startedAt) || startedAt <= nowMs - REFRESH_LEASE_MS;
  });
}

export function hasAnyCalculatedCoverage(
  snapshots: ReadonlyMap<CoverageKind, CoverageSnapshot>,
): boolean {
  return COVERAGE_KINDS.some((kind) => snapshots.get(kind)?.calculatedAt !== null);
}

/**
 * Refreshes stale snapshots after the response. One atomic RPC claims every
 * eligible row with a ten-minute database lease, so competing page views cannot
 * split the four expensive finders across workers. Claimed finders then run
 * sequentially: each already has a bounded pool of six database reads, and
 * stacking four pools would defeat that bound.
 */
export async function refreshCharityCoverageSnapshots(registerBuiltOn: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  const { data, error } = await admin.rpc("claim_charity_register_coverage_refreshes", {
    p_register_built_on: registerBuiltOn,
  });
  if (error) {
    await reportError(error, { operation: "charity_register_coverage.claim" });
    return;
  }
  const claims = ((data ?? []) as Array<{ coverage_kind: string; started_at: string }>).flatMap(
    (claim) =>
      isCoverageKind(claim.coverage_kind)
        ? [{ kind: claim.coverage_kind, startedAt: claim.started_at }]
        : [],
  );
  if (claims.length === 0) return;

  let identifiers;
  try {
    identifiers = await loadCharityIdentifiers(admin);
  } catch (error) {
    await reportError(error, { operation: "charity_register_coverage.identifiers" });
    await Promise.all(
      claims.map(({ kind, startedAt }) => failRefresh(admin, kind, startedAt)),
    );
    return;
  }

  for (const claim of claims) {
    try {
      const metrics = await calculateCoverage(admin, claim.kind, identifiers);
      const { data, error } = await admin.rpc("finish_charity_register_coverage_refresh", {
        p_coverage_kind: claim.kind,
        p_started_at: claim.startedAt,
        p_register_built_on: registerBuiltOn,
        p_charities: metrics.charities,
        p_covered: metrics.covered,
        p_pending: metrics.pending,
        p_pending_items: metrics.pendingItems,
      });
      if (error) throw error;
      if (data !== true) {
        await reportError(new Error("Coverage refresh lease expired before completion"), {
          operation: "charity_register_coverage.finish",
          coverageKind: claim.kind,
        });
      }
    } catch (error) {
      await reportError(error, {
        operation: "charity_register_coverage.calculate",
        coverageKind: claim.kind,
      });
      await failRefresh(admin, claim.kind, claim.startedAt);
    }
  }
}

async function calculateCoverage(
  admin: SupabaseClient,
  kind: CoverageKind,
  identifiers: Awaited<ReturnType<typeof loadCharityIdentifiers>>,
): Promise<{ charities: number; covered: number; pending: number; pendingItems: number | null }> {
  if (kind === "annual_return") {
    const { coverage } = await findBackfillTargets(admin, undefined, identifiers);
    return { ...coverage, pendingItems: coverage.pendingPeriods };
  }
  if (kind === "profile") {
    const { coverage } = await findProfileTargets(admin, undefined, identifiers);
    return { ...coverage, pendingItems: coverage.pendingFields };
  }
  if (kind === "reach") {
    const { coverage } = await findReachTargets(admin, undefined, identifiers);
    return { ...coverage, pendingItems: null };
  }
  const { coverage } = await findCompanyNumberTargets(
    admin,
    undefined,
    undefined,
    identifiers,
  );
  return { ...coverage, pendingItems: null };
}

async function failRefresh(
  admin: SupabaseClient,
  kind: CoverageKind,
  startedAt: string,
): Promise<void> {
  const { error } = await admin.rpc("fail_charity_register_coverage_refresh", {
    p_coverage_kind: kind,
    p_started_at: startedAt,
  });
  if (error) {
    await reportError(error, {
      operation: "charity_register_coverage.fail",
      coverageKind: kind,
    });
  }
}

function isCoverageKind(value: string): value is CoverageKind {
  return (COVERAGE_KINDS as readonly string[]).includes(value);
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "42P01" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("charity_register_coverage") &&
      candidate.message.toLowerCase().includes("schema cache"))
  );
}
