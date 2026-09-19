import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeRun,
  runCriteriaSentence,
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
    const started = "2026-08-15T11:55:00.000Z";
    assert.equal(
      summariseRun(run({ job_status: "running", records_fetched: 12, started_at: started }), NOW),
      "Running now — 12 records fetched so far",
    );
    assert.equal(
      summariseRun(run({ job_status: "running", records_fetched: 0, started_at: started }), NOW),
      "Running now — nothing fetched yet",
    );
  });

  it("calls a run stalled once it cannot still be going, without its frozen counts", () => {
    // Started two hours ago: six times the longest legitimate run.
    const view = describeRun(
      run({ job_status: "running", completed_at: null, records_fetched: 12 }),
      NOW,
    );
    assert.equal(view.status, "stalled");
    assert.equal(view.statusLabel, "Stalled");
    assert.equal(view.tone, "warning");
    assert.equal(
      view.summary,
      "Stalled — started 2 hours ago and never finished. Running it again is safe.",
    );
  });

  it("keeps calling a just-started run running", () => {
    const view = describeRun(
      run({
        job_status: "running",
        completed_at: null,
        started_at: "2026-08-15T11:55:00.000Z",
      }),
      NOW,
    );
    assert.equal(view.status, "running");
    assert.equal(view.statusLabel, "Running");
    assert.equal(view.tone, "info");
  });

  it("lets a stalled run be found by searching for it", () => {
    const view = describeRun(run({ job_status: "running", completed_at: null }), NOW);
    assert.equal(matchesRunQuery(view, "stalled"), true);
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
  it("leads with the three a reader came for, and keeps the rest", () => {
    const view = describeRun(run(), NOW);
    assert.deepEqual(
      view.headline.map((count) => count.label),
      ["Added to the client list", "Already on the list", "Needs a look"],
    );
    // Nothing is dropped — the pipeline's own stages move behind the details.
    assert.ok(view.details.some((count) => count.label === "From the source"));
    assert.equal(view.counts.length, view.headline.length + view.details.length);
    assert.deepEqual(
      view.highlights.map((count) => count.label),
      ["Added to the client list", "Already on the list"],
    );
  });

  it("times the run from its own stamps", () => {
    const view = describeRun(run(), NOW);
    assert.equal(view.duration, "2m 14s");
    assert.equal(view.startedRelative, "2 hours ago");
    assert.ok(view.finishedExact);
  });

  it("refuses to invent a duration for a run still going", () => {
    const view = describeRun(
      run({
        job_status: "running",
        completed_at: null,
        started_at: "2026-08-15T11:55:00.000Z",
      }),
      NOW,
    );
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

  it("replaces the historical object placeholder with an actionable explanation", () => {
    const res = humaniseErrorMessage("[object Object]");
    assert.equal(res?.summary, "The import stopped without a readable reason");
    assert.ok(res?.description.includes("Try the import again"));
  });

  it("returns null for empty error strings", () => {
    assert.equal(humaniseErrorMessage(null), null);
    assert.equal(humaniseErrorMessage(""), null);
    assert.equal(humaniseErrorMessage("   "), null);
  });
});

describe("register imports distinguish staging from clients added", () => {
  const bulk = (overrides: Partial<IngestionRunRow> = {}): IngestionRunRow =>
    run({
      api_source: "charity_commission_bulk",
      records_fetched: 2231,
      records_inserted: 2231,
      records_skipped: 0,
      records_failed: 0,
      records_flagged: 0,
      run_stats: {
        selected: 2231,
        written: 2231,
        unchanged: 0,
        inserted: 0,
        flagged: 0,
        needsReview: 0,
        doesNotMeet: 0,
        invalidData: 0,
        failed: 1934,
      },
      ...overrides,
    });

  it("never calls staged rows added, and leads with the refusal", () => {
    const summary = summariseRun(bulk());
    assert.match(summary, /Nothing was added to the client list/);
    assert.match(summary, /all 1,934 records were refused/);
    assert.doesNotMatch(summary, /Added 2,231/);
  });

  it("says why the records were refused when the run recorded a reason", () => {
    const summary = summariseRun(
      bulk({
        run_stats: {
          selected: 2231,
          written: 2231,
          unchanged: 0,
          inserted: 0,
          failed: 1934,
          failureReasons: ['invalid input value for enum public.outreach_status: "not_started"'],
        },
      }),
    );
    assert.match(summary, /needs a database update/);
    // The database's own words never reach the reader's sentence.
    assert.doesNotMatch(summary, /enum|outreach_status/);
  });

  it("shows a refusal that saved some records as partly done, not as a clean run", () => {
    const view = describeRun(
      bulk({
        run_stats: {
          selected: 100,
          written: 100,
          unchanged: 0,
          inserted: 40,
          failed: 60,
          failureReasons: ["duplicate key value violates unique constraint"],
        },
      }),
      new Date("2026-09-19T14:00:00Z"),
    );
    assert.equal(view.status, "partial");
    assert.match(view.summary, /40 added to the client list, 60 records refused/);
    assert.ok(view.humanError);
    assert.match(view.humanError!.actionHint ?? "", /review queue/);
  });

  it("admits when an older run kept no reason rather than showing nothing", () => {
    const view = describeRun(bulk(), new Date("2026-09-19T14:00:00Z"));
    assert.equal(view.status, "failed");
    assert.match(view.humanError?.summary ?? "", /did not record why/);
  });

  it("reads clients added from the promotion breakdown", () => {
    const summary = summariseRun(
      bulk({
        records_fetched: 66,
        records_inserted: 66,
        run_stats: {
          selected: 66,
          written: 66,
          unchanged: 0,
          inserted: 60,
          flagged: 2,
          needsReview: 1,
          doesNotMeet: 2,
          invalidData: 1,
          failed: 0,
        },
      }),
    );
    assert.match(summary, /60 added to the client list from 66 records in the source/);
    // Held, duplicate and unusable records are one number: the reader wants to
    // know whether anything is waiting on them, not how it is filed.
    assert.match(summary, /4 need a look/);
    assert.match(summary, /2 did not fit the client criteria/);
    // The holding table is an implementation step, not an outcome.
    assert.doesNotMatch(summary, /staged|Staged/);
  });

  it("claims no outcome when the records were never added", () => {
    const summary = summariseRun(
      bulk({ run_stats: { selected: 2231, written: 2231, unchanged: 0 } }),
    );
    assert.equal(summary, "2,231 records from the source are waiting to be added");
  });

  it("says when the total includes records earlier imports left behind", () => {
    const summary = summariseRun(
      bulk({
        records_fetched: 98,
        records_inserted: 42,
        run_stats: { selected: 98, written: 42, unchanged: 56, inserted: 821, failed: 0 },
      }),
    );
    assert.match(summary, /821 added to the client list from 98 records in the source/);
    assert.match(summary, /about 779 of them had been waiting from earlier imports/);
  });

  it("says nothing about a backlog when there was none", () => {
    const summary = summariseRun(
      bulk({
        records_fetched: 66,
        run_stats: { selected: 66, written: 60, unchanged: 6, inserted: 60, failed: 0 },
      }),
    );
    assert.doesNotMatch(summary, /waiting from earlier imports/);
  });

  it("asks a run without a breakdown the same three questions", () => {
    const view = describeRun(run({ api_source: "charitybase" }), NOW);
    assert.deepEqual(
      view.headline.map((count) => count.label),
      ["Added to the client list", "Already on the list", "Needs a look"],
    );
  });

  it("never headlines the holding table, and counts what needs a person", () => {
    const view = describeRun(bulk(), NOW);
    assert.ok(!view.headline.some((count) => /stag/i.test(count.label)));
    assert.equal(
      view.headline.find((count) => count.label === "Added to the client list")?.value,
      0,
    );
    // 1,934 refused saves are the thing waiting on someone here.
    assert.equal(view.headline.find((count) => count.label === "Needs a look")?.value, 1934);
    assert.equal(
      view.details.find((count) => count.label === "From the source")?.value,
      2231,
    );
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

describe("counts that can be opened", () => {
  it("points 'needs a look' at the records that are waiting on someone", () => {
    const view = describeRun(
      run({
        api_source: "charity_commission_bulk",
        run_stats: { selected: 10, written: 10, unchanged: 0, inserted: 7, flagged: 2, failed: 1 },
      }),
      NOW,
    );
    const needsLook = view.headline.find((count) => count.label === "Needs a look");
    assert.deepEqual(needsLook?.statusKeys, ["matched", "rejected_review", "error"]);
    // Red, because it is the one count that asks the reader for something.
    assert.equal(needsLook?.tone, "danger");
  });

  it("gives a count with no records behind it nothing to open", () => {
    const view = describeRun(run(), NOW);
    const already = view.headline.find((count) => count.label === "Already on the list");
    assert.equal(already?.statusKeys, undefined);
  });
});

describe("runCriteriaSentence", () => {
  it("reads back what the run was asked for", () => {
    const view = describeRun(
      run({
        run_stats: {
          selected: 98,
          criteriaSentence: "Operating in Cumbria; excluding insolvent charities.",
        },
      }),
      NOW,
    );
    assert.equal(
      view.criteriaSentence,
      "Operating in Cumbria; excluding insolvent charities.",
    );
  });

  it("says nothing for a run that recorded no criteria", () => {
    assert.equal(runCriteriaSentence(run({ run_stats: { selected: 98 } })), null);
    assert.equal(runCriteriaSentence(run({ run_stats: null })), null);
    assert.equal(runCriteriaSentence(run({ run_stats: { criteriaSentence: "  " } })), null);
  });
});
