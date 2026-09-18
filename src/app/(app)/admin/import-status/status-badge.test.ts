import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isStalledRun, labelForStatus, runDisplayStatus, stalledRunSummary, styleForStatus } from "./status-helpers.ts";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

describe("labelForStatus", () => {
  it("maps each known job_status to its display label", () => {
    assert.equal(labelForStatus("completed"), "Succeeded");
    assert.equal(labelForStatus("partial"), "Partially succeeded");
    assert.equal(labelForStatus("failed"), "Failed");
    assert.equal(labelForStatus("running"), "Running");
    assert.equal(labelForStatus("stalled"), "Stalled");
  });

  it("falls back to the raw status string for an unknown value", () => {
    assert.equal(labelForStatus("something_new"), "something_new");
  });
});

describe("styleForStatus", () => {
  it("gives failed a red style and completed a green style", () => {
    assert.match(styleForStatus("failed"), /red/);
    assert.match(styleForStatus("completed"), /green/);
  });

  it("gives stalled the same amber style as partial", () => {
    assert.equal(styleForStatus("stalled"), styleForStatus("partial"));
  });

  it("falls back to a neutral gray style for an unknown value", () => {
    assert.match(styleForStatus("something_new"), /gray/);
  });
});

describe("isStalledRun", () => {
  it("leaves a just-started run alone", () => {
    assert.equal(isStalledRun(minutesAgo(5), NOW), false);
  });

  it("calls a run stalled once it is older than any legitimate run", () => {
    assert.equal(isStalledRun(minutesAgo(31), NOW), true);
    assert.equal(isStalledRun(minutesAgo(30), NOW), true);
    assert.equal(isStalledRun(minutesAgo(29), NOW), false);
  });

  it("never declares a stall on a timestamp it cannot read", () => {
    assert.equal(isStalledRun(null, NOW), false);
    assert.equal(isStalledRun(undefined, NOW), false);
    assert.equal(isStalledRun("not-a-date", NOW), false);
    assert.equal(isStalledRun(minutesAgo(-5), NOW), false);
  });
});

describe("runDisplayStatus", () => {
  it("shows stalled for an old running run and nothing else", () => {
    assert.equal(runDisplayStatus("running", minutesAgo(60), NOW), "stalled");
    assert.equal(runDisplayStatus("running", minutesAgo(5), NOW), "running");
    assert.equal(runDisplayStatus("completed", minutesAgo(60), NOW), "completed");
    assert.equal(runDisplayStatus("failed", minutesAgo(60), NOW), "failed");
  });
});

describe("stalledRunSummary", () => {
  it("says when the run started and that starting over is safe", () => {
    assert.equal(
      stalledRunSummary("2026-08-15T10:00:00.000Z", NOW),
      "Stalled — started 2 hours ago and never finished. Running it again is safe.",
    );
  });
});