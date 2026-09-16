import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IngestionRunRow } from "../../app/(app)/admin/import-status/run-format.ts";
import { countCreatedSince, summariseDataHealth, type DataHealthInput } from "./data-health.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");

const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

function run(overrides: Partial<IngestionRunRow> = {}): IngestionRunRow {
  return {
    id: "run-1",
    api_source: "companies_house",
    job_status: "completed",
    records_fetched: 100,
    records_inserted: 10,
    records_skipped: 90,
    records_failed: 0,
    records_flagged: 0,
    started_at: daysAgo(1),
    completed_at: daysAgo(1),
    error_message: null,
    ...overrides,
  };
}

function input(overrides: Partial<DataHealthInput> = {}): DataHealthInput {
  return {
    now: NOW,
    organisations: 1200,
    contacts: 300,
    addedRecently: 12,
    duplicates: 0,
    enrichmentReview: 0,
    missingWebsite: 40,
    missingEmail: 80,
    runs: [],
    ...overrides,
  };
}

describe("countCreatedSince", () => {
  it("counts records inside the window and skips unreadable dates", () => {
    const count = countCreatedSince(
      [{ created_at: daysAgo(1) }, { created_at: daysAgo(6.9) }, { created_at: daysAgo(8) }, { created_at: "nope" }],
      NOW,
      7,
    );
    assert.equal(count, 2);
  });
});

describe("summariseDataHealth", () => {
  it("is quiet when nothing needs a person, even with gaps in the register", () => {
    const summary = summariseDataHealth(input());
    assert.deepEqual(summary.warnings, []);
    assert.equal(summary.incomplete, false);
  });

  it("raises possible duplicates and links to the review screen", () => {
    const summary = summariseDataHealth(input({ duplicates: 3 }));
    assert.equal(summary.warnings.length, 1);
    const duplicates = summary.checks.find((figure) => figure.key === "duplicates");
    assert.equal(duplicates?.tone, "attention");
    assert.equal(duplicates?.href, "/admin/duplicates");
  });

  it("reports each source's newest run and warns about a failed one", () => {
    const summary = summariseDataHealth(
      input({
        runs: [
          run({ id: "newest", job_status: "failed", records_fetched: 0, started_at: daysAgo(0.1) }),
          run({ id: "older", started_at: daysAgo(2) }),
          run({ id: "other", api_source: "charity_commission_bulk", started_at: daysAgo(3) }),
        ],
      }),
    );
    assert.equal(summary.sources?.length, 2);
    assert.equal(summary.sources?.[0].source, "Companies House");
    assert.equal(summary.sources?.[0].tone, "attention");
    assert.equal(summary.sources?.[1].tone, "ok");
    assert.match(summary.sources?.[1].note ?? "", /^Last run /);
    assert.equal(summary.warnings.length, 1);
    assert.match(summary.warnings[0], /^Companies House: Failed/);
  });

  it("keeps a failed read distinct from an empty one", () => {
    const summary = summariseDataHealth(input({ runs: null, contacts: null }));
    assert.equal(summary.sources, null);
    assert.equal(summary.incomplete, true);
  });

  it("calls a day-old running run stalled instead of running", () => {
    const summary = summariseDataHealth(
      input({
        runs: [run({ job_status: "running", started_at: daysAgo(3) })],
      }),
    );
    assert.match(summary.sources?.[0].note ?? "", /^Stalled — started 3 days ago/);
  });
});
