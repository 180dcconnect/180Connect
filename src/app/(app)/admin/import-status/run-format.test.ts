import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeRun,
  formatSource,
  humaniseErrorMessage,
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

  it("keeps and humanises the error message for a failed run", () => {
    const view = describeRun(
      run({ job_status: "failed", error_message: "COMPANIES_HOUSE_API_KEY is not set." }),
      NOW,
    );
    assert.equal(view.errorMessage, "COMPANIES_HOUSE_API_KEY is not set.");
    assert.equal(view.humanError?.summary, "Companies House API access key is not set");
    assert.ok(view.humanError?.actionHint?.includes("COMPANIES_HOUSE_API_KEY"));
    assert.equal(view.tone, "danger");
  });
});

describe("humaniseErrorMessage", () => {
  it("translates missing Companies House API key into clear instructions", () => {
    const res = humaniseErrorMessage("COMPANIES_HOUSE_API_KEY is not set.");
    assert.equal(res?.summary, "Companies House API access key is not set");
    assert.ok(res?.actionHint?.includes("COMPANIES_HOUSE_API_KEY"));
  });

  it("translates missing Charity Commission API key into clear instructions", () => {
    const res = humaniseErrorMessage("CHARITY_COMMISSION_API_KEY is not set.");
    assert.equal(res?.summary, "Charity Commission API subscription key is not set");
    assert.ok(res?.actionHint?.includes("CHARITY_COMMISSION_API_KEY"));
  });

  it("translates 401 unauthorized errors", () => {
    const res = humaniseErrorMessage("401 Unauthorized: Invalid API key");
    assert.equal(res?.summary, "Authentication rejected by the data provider");
    assert.ok(res?.actionHint?.includes("Verify that your configured API key"));
  });

  it("translates 429 rate limit errors", () => {
    const res = humaniseErrorMessage("429 Too Many Requests");
    assert.equal(res?.summary, "Rate limit reached on external registry");
  });

  it("translates network timeouts", () => {
    const res = humaniseErrorMessage("fetch failed: ETIMEDOUT connection timed out");
    assert.equal(res?.summary, "Connection timed out with registry service");
  });

  it("returns null for empty error strings", () => {
    assert.equal(humaniseErrorMessage(null), null);
    assert.equal(humaniseErrorMessage(""), null);
    assert.equal(humaniseErrorMessage("   "), null);
  });
});

describe("matchesRunQuery", () => {
  const view = describeRun(
    run({ job_status: "failed", error_message: "COMPANIES_HOUSE_API_KEY is not set." }),
    NOW,
  );

  it("matches the words the reader can see in the summary or human error", () => {
    assert.equal(matchesRunQuery(view, "companies house"), true);
    assert.equal(matchesRunQuery(view, "failed"), true);
    assert.equal(matchesRunQuery(view, "access key"), true);
    assert.equal(matchesRunQuery(view, "not set"), true);
  });

  it("requires every word, not any", () => {
    assert.equal(matchesRunQuery(view, "companies charitybase"), false);
  });

  it("matches date keys and date labels", () => {
    assert.equal(matchesRunQuery(view, "2026-08-15"), true);
    assert.equal(matchesRunQuery(view, "august"), true);
  });

  it("matches trigger type when present", () => {
    const manualView = describeRun(run({ triggered_by: "manual" }), NOW);
    assert.equal(matchesRunQuery(manualView, "manual"), true);
    const scheduledView = describeRun(run({ triggered_by: "schedule" }), NOW);
    assert.equal(matchesRunQuery(scheduledView, "scheduled"), true);
  });

  it("matches everything on an empty query", () => {
    assert.equal(matchesRunQuery(view, "  "), true);
  });
});
