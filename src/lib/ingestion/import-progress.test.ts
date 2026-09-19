import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  estimateRegisterImportSeconds,
  importProgressPlanFromStats,
  importProgressReadingAt,
  registerImportProgressStats,
} from "./import-progress.ts";

describe("register import progress", () => {
  it("records one compact estimate from the known selection size", () => {
    assert.deepEqual(registerImportProgressStats(2_231), {
      estimated_total_items: 2_231,
      estimated_duration_seconds: 1_116,
    });
    assert.equal(estimateRegisterImportSeconds(1), 1);
  });

  it("prefers a real source heartbeat to an estimate", () => {
    assert.deepEqual(
      importProgressPlanFromStats({
        walked_organisations: 12,
        total_organisations: 25,
        estimated_total_items: 100,
        estimated_duration_seconds: 50,
      }),
      { kind: "measured", completed: 12, total: 25 },
    );
  });

  it("reads a register estimate and rejects malformed metadata", () => {
    assert.deepEqual(
      importProgressPlanFromStats({
        estimated_total_items: 100,
        estimated_duration_seconds: 50,
      }),
      { kind: "estimated", total: 100, durationSeconds: 50 },
    );
    assert.equal(importProgressPlanFromStats({ estimated_total_items: "100" }), null);
    assert.equal(importProgressPlanFromStats(null), null);
  });

  it("counts down without claiming completion before the run finishes", () => {
    const reading = importProgressReadingAt(
      { kind: "estimated", total: 100, durationSeconds: 50 },
      "2026-09-19T12:00:00.000Z",
      Date.parse("2026-09-19T12:00:20.000Z"),
    );
    assert.equal(reading.percent, 40);
    assert.match(reading.statusText, /0:20 so far/);
    assert.match(reading.statusText, /about 0:30 to go \(estimated\)/);

    const overtime = importProgressReadingAt(
      { kind: "estimated", total: 100, durationSeconds: 50 },
      "2026-09-19T12:00:00.000Z",
      Date.parse("2026-09-19T12:01:00.000Z"),
    );
    assert.equal(overtime.percent, 95);
    assert.match(overtime.statusText, /taking longer than estimated/);
  });

  it("turns measured progress into a rate-based countdown", () => {
    const reading = importProgressReadingAt(
      { kind: "measured", completed: 10, total: 25 },
      "2026-09-19T12:00:00.000Z",
      Date.parse("2026-09-19T12:00:20.000Z"),
    );
    assert.equal(reading.percent, 40);
    assert.match(reading.statusText, /10 of 25 source checks finished/);
    assert.match(reading.statusText, /about 0:30 to go/);
  });
});
