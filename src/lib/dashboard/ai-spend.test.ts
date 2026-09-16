import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aiSpendChange,
  aiSpendSummary,
  aiSpendWindowStart,
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

describe("aiSpendWindowStart", () => {
  it("reaches past the 1st of last month after a short month", () => {
    // 31 days into March needs ~31 days before 1 March, i.e. late January —
    // a fetch from 1 February would count those days as zero spend.
    const start = aiSpendWindowStart(new Date("2026-03-31T12:00:00Z"));
    assert.ok(start < new Date("2026-02-01T00:00:00Z"));
    assert.equal(start.toISOString(), "2026-01-29T12:00:00.000Z");
  });

  it("counts prior-stretch rows from before last month's 1st", () => {
    const now = new Date("2026-03-31T12:00:00Z");
    const summary = aiSpendSummary([gen({ created_at: "2026-01-30T00:00:00Z", cost_usd: 3 })], now);
    assert.equal(summary.priorCostUsd, 3);
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
