import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_SPEND_PERIODS,
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
    assert.equal(summary.periodFrom, "2026-09-01");
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

  it("puts rows before the month into the prior stretch of equal length", () => {
    // 1-10 Sept is 10 days (less 12h), so the prior stretch reaches back to ~22 Aug.
    const summary = aiSpendSummary(
      [gen({ created_at: "2026-09-02T00:00:00Z", cost_usd: 1 }), gen({ created_at: "2026-08-25T00:00:00Z", cost_usd: 4 })],
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

describe("the month window's comparison", () => {
  it("reaches past the 1st of last month after a short month", () => {
    // 31 days into March needs ~31 days before 1 March, i.e. late January —
    // a window that started on 1 February would count those days as zero spend
    // and report a rise that never happened.
    const start = new Date(aiSpendPriorWindow(AI_SPEND_PERIODS[0], new Date("2026-03-31T12:00:00Z")).fromMs);
    assert.ok(start < new Date("2026-02-01T00:00:00Z"));
    assert.equal(start.toISOString(), "2026-01-29T12:00:00.000Z");
  });

  it("counts prior-stretch rows from before last month's 1st", () => {
    const now = new Date("2026-03-31T12:00:00Z");
    const summary = aiSpendSummary([gen({ created_at: "2026-01-30T00:00:00Z", cost_usd: 3 })], now);
    assert.equal(summary.priorCostUsd, 3);
  });
});

describe("aiSpendPeriods", () => {
  const PERIOD_NOW = new Date("2026-09-16T12:00:00Z");
  const MONTH = AI_SPEND_PERIODS[0];
  const THIRTY = AI_SPEND_PERIODS[1];
  const NINETY = AI_SPEND_PERIODS[2];
  const YEAR = AI_SPEND_PERIODS[3];

  it("reads the last 30 calendar days, today included", () => {
    const window = aiSpendPeriodWindow(THIRTY, PERIOD_NOW);
    assert.equal(new Date(window.fromMs).toISOString(), "2026-08-18T00:00:00.000Z");
    assert.equal(window.toMs, PERIOD_NOW.getTime());
  });

  it("leaves month to date reading the 1st through today", () => {
    const window = aiSpendPeriodWindow(MONTH, PERIOD_NOW);
    assert.equal(new Date(window.fromMs).toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(aiSpendSummary([], PERIOD_NOW, MONTH).periodFrom, "2026-09-01");
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

  it("fetches back far enough for the longest period's own comparison", () => {
    const longest = aiSpendPeriodWindow(YEAR, PERIOD_NOW);
    const start = aiSpendFetchStart(PERIOD_NOW);
    assert.ok(start.getTime() <= longest.fromMs - (longest.toMs - longest.fromMs));
    // The widest requirement wins, so the month's own stretch is not the limit.
    assert.ok(
      start.getTime() < aiSpendPriorWindow(AI_SPEND_PERIODS[0], PERIOD_NOW).fromMs,
    );
  });

  it("builds one reading per offered period, in the control's order", () => {
    const readings = aiSpendReadings([], PERIOD_NOW);
    assert.deepEqual(
      readings.map((reading) => reading.period.id),
      ["month", "30d", "90d", "365d"],
    );
  });

  it("counts the same rows differently at each length, as the windows widen", () => {
    // 1 July sits outside both the month and the last 30 days, and inside the
    // last 3 months — so the reading above the dropdown really does follow it.
    const rows = [
      gen({ created_at: "2026-07-01T00:00:00Z", cost_usd: 5 }),
      gen({ created_at: "2026-09-10T00:00:00Z", cost_usd: 1 }),
    ];
    const [month, thirty, ninety] = aiSpendReadings(rows, PERIOD_NOW);
    assert.equal(month.summary.costUsd, 1);
    assert.equal(thirty.summary.costUsd, 1);
    assert.equal(ninety.summary.costUsd, 6);
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
      [gen({ created_at: "2026-09-02T00:00:00Z", cost_usd: 2 }), gen({ created_at: "2026-08-25T00:00:00Z", cost_usd: 1 })],
      NOW,
    ));
    assert.equal(change, 100);
  });

  it("returns null off a zero baseline instead of a false +100%", () => {
    assert.equal(aiSpendChange(aiSpendSummary([gen({ cost_usd: 5 })], NOW)), null);
  });
});

describe("formatUsd", () => {
  it("formats to two decimals", () => {
    assert.equal(formatUsd(12.345), "$12.35");
    assert.equal(formatUsd(0), "$0.00");
  });

  it("does not round a real sub-cent cost away to zero", () => {
    assert.equal(formatUsd(0.0004), "<$0.01");
  });
});
