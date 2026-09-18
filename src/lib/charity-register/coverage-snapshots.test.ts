import assert from "node:assert/strict";
import test from "node:test";

import {
  coverageRefreshShouldStart,
  coverageSnapshotsNeedRefresh,
  hasAnyCalculatedCoverage,
  type CoverageKind,
  type CoverageSnapshot,
} from "./coverage-snapshots.ts";

const BUILT_ON = "2026-09-18";

function snapshots(overrides: Partial<Record<CoverageKind, Partial<CoverageSnapshot>>> = {}) {
  const result = new Map<CoverageKind, CoverageSnapshot>();
  for (const coverageKind of [
    "annual_return",
    "profile",
    "reach",
    "company_number",
  ] as const) {
    result.set(coverageKind, {
      coverageKind,
      charities: 20,
      covered: 18,
      pending: 2,
      pendingItems: coverageKind === "annual_return" || coverageKind === "profile" ? 3 : null,
      registerBuiltOn: BUILT_ON,
      calculatedAt: "2026-09-18T12:00:00.000Z",
      staleAt: null,
      refreshStartedAt: null,
      ...overrides[coverageKind],
    });
  }
  return result;
}

test("fresh complete snapshots need no refresh", () => {
  assert.equal(coverageSnapshotsNeedRefresh(snapshots(), BUILT_ON), false);
});

test("missing, stale, blank, or older-register snapshots need refresh", () => {
  const missing = snapshots();
  missing.delete("reach");
  assert.equal(coverageSnapshotsNeedRefresh(missing, BUILT_ON), true);
  assert.equal(
    coverageSnapshotsNeedRefresh(
      snapshots({ profile: { staleAt: "2026-09-18T13:00:00.000Z" } }),
      BUILT_ON,
    ),
    true,
  );
  assert.equal(
    coverageSnapshotsNeedRefresh(snapshots({ annual_return: { calculatedAt: null } }), BUILT_ON),
    true,
  );
  assert.equal(
    coverageSnapshotsNeedRefresh(
      snapshots({ company_number: { registerBuiltOn: "2026-09-17" } }),
      BUILT_ON,
    ),
    true,
  );
});

test("calculated coverage is distinguished from seeded blank rows", () => {
  assert.equal(hasAnyCalculatedCoverage(snapshots()), true);
  assert.equal(
    hasAnyCalculatedCoverage(
      snapshots({
        annual_return: { calculatedAt: null },
        profile: { calculatedAt: null },
        reach: { calculatedAt: null },
        company_number: { calculatedAt: null },
      }),
    ),
    false,
  );
});

test("an active lease prevents duplicate work but an expired lease is reclaimable", () => {
  const now = new Date("2026-09-18T12:10:00.000Z").getTime();
  const active = snapshots({
    profile: {
      staleAt: "2026-09-18T12:00:00.000Z",
      refreshStartedAt: "2026-09-18T12:05:00.000Z",
    },
  });
  assert.equal(coverageRefreshShouldStart(active, BUILT_ON, now), false);

  active.get("profile")!.refreshStartedAt = "2026-09-18T11:59:59.000Z";
  assert.equal(coverageRefreshShouldStart(active, BUILT_ON, now), true);
});
