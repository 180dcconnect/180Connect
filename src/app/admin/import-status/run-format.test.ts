import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeRun,
  formatSource,
  matchesRunQuery,
  summariseRun,
  toneForStatus,
  type IngestionRunRow,
} from "./run-format.ts";

const NOW = new Date("2026-08-15T12:00:00.000Z");

function run(overrides: Partial<IngestionRunRow> = {}): IngestionRunRow {
  return {
    id: "run-1",
    api_source: "companies_house",
    job_status: "completed",
    records_fetched: 1240,
    records_inserted: 980,
    records_skipped: 260,
    records_failed: 0,
    records_flagged: 0,
    started_at: "2026-08-15T10:00:00.000Z",
    completed_at: "2026-08-15T10:02:14.000Z",
    error_message: null,
    ...overrides,
  };
}

describe("formatSource", () => {
  it("spells each source the way its owner spells it", () => {
    assert.equal(formatSource("companies_house"), "Companies House");
    assert.equal(formatSource("charitybase"), "CharityBase");
    assert.equal(formatSource("360giving"), "360Giving");
  });

  it("humanises a source added to the domain but not yet to the map", () => {
    assert.equal(formatSource("some_new_registry"), "Some new registry");
  });
});

describe("toneForStatus", () => {
  it("maps the four job statuses onto the badge's four colours", () => {
    assert.equal(toneForStatus("completed"), "success");
    assert.equal(toneForStatus("partial"), "warning");
    assert.equal(toneForStatus("failed"), "danger");
    assert.equal(toneForStatus("running"), "info");
  });

  it("falls back to neutral for a status it has never seen", () => {
    assert.equal(toneForStatus("cancelled_by_operator"), "neutral");
  });
});

describe("summariseRun", () => {
  it("leads with what was added, not with the status", () => {
    assert.equal(summariseRun(run()), "Added 980 of 1,240 records");
  });

  it("distinguishes a clean run from one that added nothing", () => {
    assert.equal(
      summariseRun(run({ records_inserted: 0 })),
      "Added nothing new from 1,240 records",
    );
  });

  it("says a partial run did not finish, so the number is not read as a success", () => {
    assert.equal(
      summariseRun(run({ job_status: "partial" })),
      "Added 980 of 1,240 records — the run did not finish cleanly",
    );
  });

  it("says how far a failed run got", () => {
    assert.equal(
      summariseRun(run({ job_status: "failed", records_fetched: 40 })),
      "Failed after fetching 40 records",
    );
    assert.equal(
      summariseRun(run({ job_status: "failed", records_fetched: 0 })),
      "Failed before fetching anything",
    );
  });

  it("reports a still-running job as running", () => {
    assert.equal(
      summariseRun(run({ job_status: "running", records_fetched: 12 })),
      "Running now — 12 records fetched so far",
    );
    assert.equal(
      summariseRun(run({ job_status: "running", records_fetched: 0 })),
      "Running now — nothing fetched yet",
    );
  });

  it("does not call an empty source a failure", () => {
    assert.equal(
      summariseRun(run({ records_fetched: 0, records_inserted: 0, records_skipped: 0 })),
      "Nothing to fetch — the source returned no records",
    );
  });

  it("gets the singular right", () => {
    assert.equal(
      summariseRun(run({ records_fetched: 1, records_inserted: 1, records_skipped: 0 })),
      "Added 1 of 1 record",
    );
  });
});

describe("describeRun", () => {
  it("keeps every count but highlights only the ones that happened", () => {
    const view = describeRun(run(), NOW);
    assert.equal(view.counts.length, 5);
    assert.deepEqual(
      view.highlights.map((count) => count.label),
      ["Fetched", "Added", "Skipped"],
    );
  });

  it("times the run from its own stamps", () => {
    const view = describeRun(run(), NOW);
    assert.equal(view.duration, "2m 14s");
    assert.equal(view.startedRelative, "2 hours ago");
    assert.ok(view.finishedExact);
  });

  it("refuses to invent a duration for a run still going", () => {
    const view = describeRun(run({ job_status: "running", completed_at: null }), NOW);
    assert.equal(view.duration, "—");
    assert.equal(view.finishedExact, null);
  });

  it("carries the badge's own label rather than a second spelling of it", () => {
    assert.equal(describeRun(run({ job_status: "partial" }), NOW).statusLabel, "Partially succeeded");
  });

  it("keeps the error message for a failed run", () => {
    const view = describeRun(
      run({ job_status: "failed", error_message: "429 rate limited by the source" }),
      NOW,
    );
    assert.equal(view.errorMessage, "429 rate limited by the source");
    assert.equal(view.tone, "danger");
  });
});

describe("matchesRunQuery", () => {
  const view = describeRun(run({ job_status: "failed", error_message: "429 rate limited" }), NOW);

  it("matches the words the reader can see", () => {
    assert.equal(matchesRunQuery(view, "companies house"), true);
    assert.equal(matchesRunQuery(view, "failed"), true);
    assert.equal(matchesRunQuery(view, "rate limited"), true);
  });

  it("requires every word, not any", () => {
    assert.equal(matchesRunQuery(view, "companies charitybase"), false);
  });

  it("matches everything on an empty query", () => {
    assert.equal(matchesRunQuery(view, "  "), true);
  });
});
