import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_SPEND_PERIODS,
  DEFAULT_AI_SPEND_PERIOD,
  aiSpendActivityRows,
  aiSpendChange,
  aiSpendFetchStart,
  aiSpendPeriodWindow,
  aiSpendPriorWindow,
  aiSpendReadings,
  aiSpendSummary,
  formatShare,
  formatSpendDay,
  formatUsd,
  toAiGenerationActivity,
  type AiGenerationCostRow,
} from "./ai-spend.ts";

const NOW = new Date("2026-09-10T12:00:00Z");

function gen(overrides: Partial<AiGenerationCostRow> = {}): AiGenerationCostRow {
  return {
    created_at: "2026-09-05T00:00:00Z",
    cost_usd: 0.01,
    total_tokens: 1000,
    model: "claude-sonnet-5",
    ...overrides,
  };
}

describe("aiSpendSummary", () => {
  it("returns an empty period cleanly", () => {
    const summary = aiSpendSummary([], NOW);
    assert.equal(summary.costUsd, 0);
    assert.equal(summary.generations, 0);
    assert.equal(summary.unpriced, 0);
    assert.deepEqual(summary.models, []);
    assert.equal(summary.periodFrom, "2026-08-12");
    assert.equal(summary.periodTo, "2026-09-10");
  });

  it("sums month-to-date cost and tokens", () => {
    const summary = aiSpendSummary(
      [gen({ cost_usd: 0.02 }), gen({ cost_usd: 0.03, total_tokens: 500 })],
      NOW,
    );
    assert.ok(Math.abs(summary.costUsd - 0.05) < 1e-9);
    assert.equal(summary.totalTokens, 1500);
    assert.equal(summary.generations, 2);
  });

  it("counts a null cost as unpriced rather than as zero", () => {
    const summary = aiSpendSummary([gen({ cost_usd: 0.02 }), gen({ cost_usd: null })], NOW);
    assert.ok(Math.abs(summary.costUsd - 0.02) < 1e-9);
    assert.equal(summary.generations, 2);
    assert.equal(summary.unpriced, 1);
  });

  it("parses a numeric column handed back as a string", () => {
    const summary = aiSpendSummary([gen({ cost_usd: "0.012345" })], NOW);
    assert.ok(Math.abs(summary.costUsd - 0.012345) < 1e-9);
    assert.equal(summary.unpriced, 0);
  });

  it("treats an unparseable cost as unpriced rather than adding NaN", () => {
    const summary = aiSpendSummary([gen({ cost_usd: "not-a-number" })], NOW);
    assert.equal(summary.costUsd, 0);
    assert.equal(summary.unpriced, 1);
  });

  it("puts rows before the window into the prior stretch of equal length", () => {
    // 10 Sept is inside the last 30 days (from 12 Aug); 20 July sits in the
    // equal-length stretch before it.
    const summary = aiSpendSummary(
      [gen({ created_at: "2026-09-02T00:00:00Z", cost_usd: 1 }), gen({ created_at: "2026-07-20T00:00:00Z", cost_usd: 4 })],
      NOW,
    );
    assert.equal(summary.costUsd, 1);
    assert.equal(summary.priorCostUsd, 4);
    // The prior stretch is not part of the headline count.
    assert.equal(summary.generations, 1);
  });

  it("excludes rows older than the prior stretch entirely", () => {
    const summary = aiSpendSummary([gen({ created_at: "2026-05-01T00:00:00Z", cost_usd: 9 })], NOW);
    assert.equal(summary.costUsd, 0);
    assert.equal(summary.priorCostUsd, 0);
  });

  it("lists distinct models, name-sorted, ignoring nulls", () => {
    const summary = aiSpendSummary(
      [gen({ model: "claude-opus-5" }), gen({ model: "claude-sonnet-5" }), gen({ model: "claude-opus-5" }), gen({ model: null })],
      NOW,
    );
    assert.deepEqual(summary.models, ["claude-opus-5", "claude-sonnet-5"]);
    assert.equal(summary.generations, 4);
  });

  it("skips rows with an unparseable created_at", () => {
    const summary = aiSpendSummary([gen({ created_at: "nonsense" })], NOW);
    assert.equal(summary.generations, 0);
  });
});

describe("activities", () => {
  it("keeps a regeneration in its own bucket instead of folding it into initial emails", () => {
    const summary = aiSpendSummary(
      [gen({ cost_usd: 1, activity: "initial_email" }), gen({ cost_usd: 2, activity: "email_regeneration" })],
      NOW,
    );
    assert.equal(summary.activityTotals.initial_email.costUsd, 1);
    assert.equal(summary.activityTotals.email_regeneration.costUsd, 2);
    assert.equal(summary.spendByDay[0].byActivity.email_regeneration, 2);
  });

  it("maps known activity values through and anything else to other", () => {
    assert.equal(toAiGenerationActivity("follow_up_email"), "follow_up_email");
    assert.equal(toAiGenerationActivity("email_regeneration"), "email_regeneration");
    assert.equal(toAiGenerationActivity("something_new"), "other");
    assert.equal(toAiGenerationActivity(null), "other");
  });
});

describe("aiSpendActivityRows", () => {
  it("orders by cost so the biggest line item leads the instrument", () => {
    const rows = aiSpendActivityRows(
      aiSpendSummary(
        [
          gen({ cost_usd: 1, activity: "initial_email" }),
          gen({ cost_usd: 3, activity: "client_booklet" }),
          gen({ cost_usd: 2, activity: "follow_up_email" }),
        ],
        NOW,
      ),
    );
    assert.deepEqual(
      rows.map((row) => row.activity),
      ["client_booklet", "follow_up_email", "initial_email"],
    );
  });

  it("shares add up to the whole priced figure", () => {
    const summary = aiSpendSummary(
      [gen({ cost_usd: 3, activity: "initial_email" }), gen({ cost_usd: 1, activity: "other" })],
      NOW,
    );
    const rows = aiSpendActivityRows(summary);
    assert.equal(rows[0].share, 0.75);
    assert.equal(rows[1].share, 0.25);
    assert.equal(
      rows.reduce((total, row) => total + row.costUsd, 0),
      summary.costUsd,
    );
  });

  it("omits an activity nothing ran for, rather than showing it at zero", () => {
    const rows = aiSpendActivityRows(
      aiSpendSummary([gen({ cost_usd: 1, activity: "initial_email" })], NOW),
    );
    assert.deepEqual(
      rows.map((row) => row.activity),
      ["initial_email"],
    );
  });

  it("keeps an activity that ran but was never priced, at zero", () => {
    // Dropping it would let the split add up to the headline while omitting a
    // category that really did run — the same lie as folding null cost into zero.
    const rows = aiSpendActivityRows(
      aiSpendSummary(
        [gen({ cost_usd: 1, activity: "initial_email" }), gen({ cost_usd: null, activity: "client_booklet" })],
        NOW,
      ),
    );
    assert.deepEqual(
      rows.map((row) => row.activity),
      ["initial_email", "client_booklet"],
    );
    assert.equal(rows[1].costUsd, 0);
    assert.equal(rows[1].share, 0);
    assert.equal(rows[1].unpriced, 1);
  });

  it("shares the empty month without dividing by zero", () => {
    assert.deepEqual(aiSpendActivityRows(aiSpendSummary([], NOW)), []);
  });
});

describe("formatShare", () => {
  it("reads as whole percents", () => {
    assert.equal(formatShare(0.575), "58%");
    assert.equal(formatShare(1), "100%");
  });

  it("never rounds a real share down to nothing", () => {
    assert.equal(formatShare(0.0004), "<1%");
    assert.equal(formatShare(0), "0%");
  });
});

describe("the window's comparison", () => {
  it("measures a trailing window against the equal-length stretch before it", () => {
    // Never "the previous calendar period": a 30-day window against a 31-day
    // month would report a rise that is only the calendar's doing.
    const window = aiSpendPeriodWindow(AI_SPEND_PERIODS[1], new Date("2026-03-31T12:00:00Z"));
    const prior = aiSpendPriorWindow(AI_SPEND_PERIODS[1], new Date("2026-03-31T12:00:00Z"));
    assert.equal(prior.toMs, window.fromMs);
    assert.equal(prior.toMs - prior.fromMs, window.toMs - window.fromMs);
    // Equal-length, not month-bounded: 31 March compares back past 1 March.
    assert.ok(new Date(prior.fromMs) < new Date("2026-03-01T00:00:00Z"));
  });

  it("counts prior-stretch rows from before the window's start", () => {
    const now = new Date("2026-03-31T12:00:00Z");
    const summary = aiSpendSummary([gen({ created_at: "2026-02-15T00:00:00Z", cost_usd: 3 })], now, AI_SPEND_PERIODS[1]);
    assert.equal(summary.priorCostUsd, 3);
  });
});

describe("aiSpendPeriods", () => {
  const PERIOD_NOW = new Date("2026-09-16T12:00:00Z");
  const SEVEN = AI_SPEND_PERIODS[0];
  const THIRTY = AI_SPEND_PERIODS[1];
  const NINETY = AI_SPEND_PERIODS[2];
  const YTD = AI_SPEND_PERIODS[3];
  const YEAR = AI_SPEND_PERIODS[4];
  const ALL = AI_SPEND_PERIODS[5];

  it("reads the last 7 calendar days, today included", () => {
    const window = aiSpendPeriodWindow(SEVEN, PERIOD_NOW);
    assert.equal(new Date(window.fromMs).toISOString(), "2026-09-10T00:00:00.000Z");
    assert.equal(window.toMs, PERIOD_NOW.getTime());
    assert.equal(aiSpendSummary([], PERIOD_NOW, SEVEN).periodFrom, "2026-09-10");
  });

  it("reads the last 30 calendar days, today included", () => {
    const window = aiSpendPeriodWindow(THIRTY, PERIOD_NOW);
    assert.equal(new Date(window.fromMs).toISOString(), "2026-08-18T00:00:00.000Z");
    assert.equal(window.toMs, PERIOD_NOW.getTime());
  });

  it("reads year to date from 1 January through today", () => {
    const window = aiSpendPeriodWindow(YTD, PERIOD_NOW);
    assert.equal(new Date(window.fromMs).toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(window.toMs, PERIOD_NOW.getTime());
    assert.equal(aiSpendSummary([], PERIOD_NOW, YTD).periodFrom, "2026-01-01");
  });

  it("measures year to date against the same length of time before New Year", () => {
    // Never "last year": a part-year against a full one would always read as
    // a collapse, whatever spending actually did.
    const window = aiSpendPeriodWindow(YTD, PERIOD_NOW);
    const prior = aiSpendPriorWindow(YTD, PERIOD_NOW);
    assert.equal(prior.toMs, window.fromMs);
    assert.equal(prior.toMs - prior.fromMs, window.toMs - window.fromMs);
    assert.ok(new Date(prior.fromMs).getUTCFullYear() === 2025);
  });

  it("measures a window against the equal-length stretch before it", () => {
    // Never "the previous calendar period": a 30-day window against a 31-day
    // month would report a rise that is only the calendar's doing.
    const window = aiSpendPeriodWindow(THIRTY, PERIOD_NOW);
    const prior = aiSpendPriorWindow(THIRTY, PERIOD_NOW);
    assert.equal(prior.toMs, window.fromMs);
    assert.equal(prior.toMs - prior.fromMs, window.toMs - window.fromMs);
  });

  it("counts a row by the window it falls in", () => {
    const rows = [
      gen({ created_at: "2026-08-01T00:00:00Z", cost_usd: 2 }),
      gen({ created_at: "2026-01-05T00:00:00Z", cost_usd: 9 }),
    ];
    const summary = aiSpendSummary(rows, PERIOD_NOW, NINETY);
    assert.equal(summary.costUsd, 2);
    assert.equal(summary.generations, 1);
    assert.equal(summary.priorCostUsd, 0);
    assert.equal(summary.periodId, "90d");
    assert.equal(summary.periodFrom, "2026-06-19");
  });

  it("fetches back far enough for every period's own comparison", () => {
    const longest = aiSpendPeriodWindow(YEAR, PERIOD_NOW);
    const start = aiSpendFetchStart(PERIOD_NOW);
    assert.ok(start.getTime() <= longest.fromMs - (longest.toMs - longest.fromMs));
    // All time needs everything: its requirement reaches back past the epoch,
    // so the fetch is genuinely the whole table, not a bounded window.
    assert.ok(start.getTime() <= 0);
  });

  it("builds one reading per offered period, in the control's order", () => {
    const readings = aiSpendReadings([], PERIOD_NOW);
    assert.deepEqual(
      readings.map((reading) => reading.period.id),
      ["7d", "30d", "90d", "ytd", "365d", "all"],
    );
  });

  it("opens on the last 30 days, which reads against a full comparison", () => {
    assert.equal(DEFAULT_AI_SPEND_PERIOD.id, "30d");
    // Bare calls (no explicit period) agree with the control's default.
    assert.equal(aiSpendSummary([], PERIOD_NOW).periodId, "30d");
  });

  it("counts the same rows differently at each length, as the windows widen", () => {
    // 1 July sits outside the last 7 and the last 30 days, and inside the
    // last 3 months — so the reading above the dropdown really does follow it.
    const rows = [
      gen({ created_at: "2026-07-01T00:00:00Z", cost_usd: 5 }),
      gen({ created_at: "2026-09-10T00:00:00Z", cost_usd: 1 }),
    ];
    const [seven, thirty, ninety] = aiSpendReadings(rows, PERIOD_NOW);
    assert.equal(seven.summary.costUsd, 1);
    assert.equal(thirty.summary.costUsd, 1);
    assert.equal(ninety.summary.costUsd, 6);
  });

  it("bounds all time by the earliest generation ever written", () => {
    const rows = [
      gen({ created_at: "2026-09-10T00:00:00Z", cost_usd: 1 }),
      gen({ created_at: "2026-08-01T00:00:00Z", cost_usd: 2 }),
    ];
    const summary = aiSpendSummary(rows, PERIOD_NOW, ALL);
    assert.equal(summary.periodFrom, "2026-08-01");
    assert.equal(summary.periodTo, "2026-09-16");
    assert.equal(summary.costUsd, 3);
    assert.equal(summary.generations, 2);
    // Nothing exists before the first generation, so there is honestly
    // nothing to compare against.
    assert.equal(summary.priorCostUsd, 0);
    assert.equal(aiSpendChange(summary), null);
  });

  it("reads an empty all time as zeros ending today, not as a failure", () => {
    const summary = aiSpendSummary([], PERIOD_NOW, ALL);
    assert.equal(summary.periodFrom, "2026-09-16");
    assert.equal(summary.periodTo, "2026-09-16");
    assert.equal(summary.costUsd, 0);
    assert.equal(aiSpendChange(summary), null);
  });
});

describe("formatSpendDay", () => {
  it("names the day, and the year only where a span crosses one", () => {
    assert.equal(formatSpendDay("2026-09-12"), "12 Sept");
    assert.equal(formatSpendDay("2025-09-12", true), "12 Sept 2025");
  });
});

describe("aiSpendChange", () => {
  it("reports the percentage move against the prior stretch", () => {
    const change = aiSpendChange(aiSpendSummary(
      [gen({ created_at: "2026-09-02T00:00:00Z", cost_usd: 2 }), gen({ created_at: "2026-07-20T00:00:00Z", cost_usd: 1 })],
      NOW,
    ));
    assert.equal(change, 100);
  });

  it("returns null off a zero baseline instead of a false +100%", () => {
    assert.equal(aiSpendChange(aiSpendSummary([gen({ cost_usd: 5 })], NOW)), null);
  });
});

describe("formatUsd", () => {
  it("formats to two decimals with thousands separators", () => {
    assert.equal(formatUsd(12.345), "$12.35");
    assert.equal(formatUsd(0), "$0.00");
    assert.equal(formatUsd(29620), "$29,620.00");
    assert.equal(formatUsd(1234567.89), "$1,234,567.89");
  });

  it("does not round a real sub-cent cost away to zero", () => {
    assert.equal(formatUsd(0.0004), "<$0.01");
  });
});
