import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseAttemptProgress,
  type AttemptRunRow,
} from "./attempt-progress.ts";

function row(overrides: Partial<AttemptRunRow> = {}): AttemptRunRow {
  return {
    id: "run-1",
    started_at: "2026-09-04T12:00:00.000Z",
    job_status: "running",
    run_stats: null,
    ...overrides,
  };
}

describe("parseAttemptProgress", () => {
  it("reads the heartbeat walked/total out of run_stats", () => {
    assert.deepEqual(
      parseAttemptProgress(
        row({ run_stats: { walked_organisations: 12, total_organisations: 25 } }),
      ),
      { walked: 12, total: 25 },
    );
  });

  it("reads null stats as unknown rather than throwing", () => {
    // No heartbeat has landed yet — a normal mid-run state, not a corrupt row.
    assert.deepEqual(parseAttemptProgress(row({ run_stats: null })), {
      walked: null,
      total: null,
    });
  });

  it("reads non-object stats as unknown", () => {
    assert.deepEqual(parseAttemptProgress(row({ run_stats: "pending" })), {
      walked: null,
      total: null,
    });
  });

  it("drops non-numeric heartbeat values instead of passing them through", () => {
    assert.deepEqual(
      parseAttemptProgress(
        row({ run_stats: { walked_organisations: "12", total_organisations: -1 } }),
      ),
      { walked: null, total: null },
    );
  });

  it("keeps a partial heartbeat rather than discarding it", () => {
    assert.deepEqual(
      parseAttemptProgress(row({ run_stats: { walked_organisations: 3 } })),
      { walked: 3, total: null },
    );
  });
});
