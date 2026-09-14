import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IngestionRunRow } from "../import-status/run-format.ts";
import { MAX_SOURCES, summariseImportHealth } from "./import-health.ts";

const NOW = new Date("2026-09-14T12:00:00.000Z");

const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

function run(overrides: Partial<IngestionRunRow> = {}): IngestionRunRow {
  return {
    id: "run-1",
    api_source: "charity_commission",
    job_status: "completed",
    records_fetched: 100,
    records_inserted: 40,
    records_skipped: 60,
    records_failed: 0,
    records_flagged: 0,
    started_at: hoursAgo(2),
    completed_at: hoursAgo(2),
    error_message: null,
    ...overrides,
  };
}

describe("summariseImportHealth", () => {
  it("takes the newest run per source from a newest-first window", () => {
    const summary = summariseImportHealth(
      [
        run({ id: "newest", started_at: hoursAgo(2), job_status: "failed" }),
        run({ id: "older", started_at: hoursAgo(5), job_status: "completed" }),
        run({ id: "other", api_source: "companies_house", started_at: hoursAgo(3) }),
      ],
      NOW,
    );

    assert.equal(summary.sourceCount, 2);
    const charityCommission = summary.sources.find((s) => s.raw === "charity_commission")!;
    assert.equal(charityCommission.status, "failed");
    assert.equal(charityCommission.relative, "2 hours ago");
  });

  it("counts a failed or incomplete run inside the window", () => {
    const summary = summariseImportHealth(
      [run({ started_at: hoursAgo(3), job_status: "partial" })],
      NOW,
    );
    assert.equal(summary.problemRuns, 1);
    assert.equal(summary.verdict, "problems");
  });

  it("does not hold a failure older than the window against the pipeline", () => {
    const summary = summariseImportHealth(
      [run({ started_at: hoursAgo(30), job_status: "failed" })],
      NOW,
    );
    assert.equal(summary.problemRuns, 0);
    // Nothing at all ran in the last day, which is its own answer.
    assert.equal(summary.verdict, "quiet");
    assert.equal(summary.sources[0].recent, false);
  });

  it("reports healthy when the window has runs and none of them went wrong", () => {
    const summary = summariseImportHealth([run({ started_at: hoursAgo(4) })], NOW);
    assert.equal(summary.verdict, "healthy");
    assert.equal(summary.runsInWindow, 1);
  });

  it("puts a failed source above a more recent clean one", () => {
    const summary = summariseImportHealth(
      [
        run({ id: "clean", api_source: "360giving", started_at: hoursAgo(1) }),
        run({ id: "broken", api_source: "companies_house", started_at: hoursAgo(6), job_status: "failed" }),
      ],
      NOW,
    );

    assert.deepEqual(
      summary.sources.map((s) => s.raw),
      ["companies_house", "360giving"],
    );
    // The headline still names the run that actually happened last.
    assert.equal(summary.latest?.raw, "360giving");
  });

  it("caps the rows without losing the count of sources", () => {
    const runs = Array.from({ length: MAX_SOURCES + 2 }, (_, i) =>
      run({ id: `run-${i}`, api_source: `source_${i}`, started_at: hoursAgo(i + 1) }),
    );
    const summary = summariseImportHealth(runs, NOW);
    assert.equal(summary.sources.length, MAX_SOURCES);
    assert.equal(summary.sourceCount, MAX_SOURCES + 2);
  });

  it("uses the source's display name and the run's own sentence", () => {
    const summary = summariseImportHealth([run()], NOW);
    const [only] = summary.sources;
    assert.equal(only.source, "Charity Commission");
    assert.equal(only.summary, "Added 40 of 100 records");
    assert.equal(only.tone, "success");
  });
});
