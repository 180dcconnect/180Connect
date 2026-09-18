import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOpportunityFacts,
  scoreGaps,
  scoreHighlights,
  formatPriorityScore,
  priorityScoreOutOf100,
  selectPriorityOpportunities,
  type OpportunityRow,
} from "./priority-opportunities.ts";

function org(overrides: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    id: "org-1",
    legal_name: "Test Charity",
    outreach_status: "not_contacted",
    owner_id: null,
    priority_score: 0.85,
    ...overrides,
  };
}

const factors = (factorOverrides = {}, weightOverrides = {}) => ({
  factors: {
    sector: 0.5,
    geography: 0.5,
    size: 0.5,
    partnershipHistory: 0.5,
    previousContact: 0.5,
    ...factorOverrides,
  },
  weights: {
    sector: 0.2,
    geography: 0.2,
    size: 0.2,
    partnershipHistory: 0.2,
    previousContact: 0.2,
    ...weightOverrides,
  },
});

describe("formatPriorityScore", () => {
  it("prints the score as its own 0–1 reading, to one decimal", () => {
    assert.equal(formatPriorityScore(0.92), "0.9");
    assert.equal(formatPriorityScore(0.885), "0.9");
    assert.equal(formatPriorityScore(0.7), "0.7");
    assert.equal(formatPriorityScore(0.74), "0.7");
  });

  it("keeps a decimal on the ends of the scale, so the column holds", () => {
    assert.equal(formatPriorityScore(1), "1.0");
    assert.equal(formatPriorityScore(0), "0.0");
  });
});

// Kept for the analytics table's average, which talks in percentages.
describe("priorityScoreOutOf100", () => {
  it("prints the persisted 0–1 score as a whole number out of 100", () => {
    assert.equal(priorityScoreOutOf100(0.92), 92);
    assert.equal(priorityScoreOutOf100(0.885), 89);
    assert.equal(priorityScoreOutOf100(0), 0);
  });
});

describe("selectPriorityOpportunities", () => {
  it("ranks highest score first and caps at the limit", () => {
    const rows = [
      org({ id: "b", legal_name: "Beta", priority_score: 0.7 }),
      org({ id: "a", legal_name: "Alpha", priority_score: 0.92 }),
      org({ id: "c", legal_name: "Gamma", priority_score: 0.8 }),
    ];
    const picked = selectPriorityOpportunities(rows, { limit: 2 });
    assert.deepEqual(
      picked.map((row) => row.id),
      ["a", "c"],
    );
    assert.equal(picked[0].displayScore, "0.9");
  });

  it("drops unscored clients and closed outcomes", () => {
    const rows = [
      org({ id: "unscored", priority_score: null }),
      org({ id: "won", outreach_status: "converted", priority_score: 0.99 }),
      org({ id: "firm-no", outreach_status: "hard_no", priority_score: 0.98 }),
      org({ id: "soft-no", outreach_status: "soft_no", priority_score: 0.97 }),
      org({ id: "live", priority_score: 0.6 }),
    ];
    assert.deepEqual(
      selectPriorityOpportunities(rows).map((row) => row.id),
      ["live"],
    );
  });

  it("keeps in-flight and replied clients — they still need talking to", () => {
    const rows = [
      org({ id: "a", outreach_status: "follow_up_sent", priority_score: 0.7 }),
      org({ id: "b", outreach_status: "responded", priority_score: 0.8 }),
      org({ id: "c", outreach_status: "no_response", priority_score: 0.75 }),
    ];
    assert.deepEqual(
      selectPriorityOpportunities(rows).map((row) => row.id),
      ["b", "c", "a"],
    );
  });

  it("scopes to the viewer's own book plus unclaimed clients", () => {
    const rows = [
      org({ id: "mine", owner_id: "me", priority_score: 0.9 }),
      org({ id: "theirs", owner_id: "them", priority_score: 0.95 }),
      org({ id: "open", owner_id: null, priority_score: 0.8 }),
    ];
    assert.deepEqual(
      selectPriorityOpportunities(rows, { ownerId: "me" }).map((row) => row.id),
      ["mine", "open"],
    );
  });

  it("breaks score ties alphabetically for a stable order", () => {
    const rows = [
      org({ id: "b", legal_name: "Beta", priority_score: 0.8 }),
      org({ id: "a", legal_name: "Alpha", priority_score: 0.8 }),
    ];
    assert.deepEqual(
      selectPriorityOpportunities(rows).map((row) => row.id),
      ["a", "b"],
    );
  });
});

describe("scoreHighlights", () => {
  it("names what each check found, ranked by share of the lift", () => {
    const highlights = scoreHighlights(
      org({
        sector: "Education",
        facts: { incomeGBP: 1_400_000, incomePeriodEnd: "2024-03-31" },
        outreach_status: "responded",
        score_factors: factors({ sector: 0.7, size: 0.9, previousContact: 0.8 }),
      }),
    );
    assert.deepEqual(
      highlights.map((highlight) => highlight.label),
      ["£1.4m income (2024 accounts)", "Replied to us", "Education is a priority sector"],
    );
    // The fact is the line; the bar carries how much it counted.
    assert.deepEqual(
      highlights.map((highlight) => highlight.strength),
      [null, null, null],
    );
    for (const highlight of highlights) {
      assert.ok(
        typeof highlight.sharePct === "number" && highlight.sharePct > 0,
        `${highlight.label} carries a share`,
      );
    }
  });

  it("shares the lift, so the three lines account for all of it", () => {
    const highlights = scoreHighlights(
      org({ score_factors: factors({ sector: 0.7, size: 0.9, previousContact: 0.8 }) }),
    );
    const total = highlights.reduce((sum, highlight) => sum + (highlight.sharePct ?? 0), 0);
    assert.ok(Math.abs(total - 100) <= 1, `lift shares sum to ${total}`);
  });

  it("falls back to the check's name when the figure was not fetched", () => {
    const highlights = scoreHighlights(
      org({ score_factors: factors({ size: 0.9 }) }),
    );
    assert.deepEqual(highlights, [{ label: "Size", strength: "strong", sharePct: 100 }]);
  });

  it("ranks by weight-aware lift, not raw factor value", () => {
    const highlights = scoreHighlights(
      org({
        score_factors: factors(
          { sector: 0.9, size: 0.6 },
          { sector: 0.05, geography: 0.2, size: 0.35, partnershipHistory: 0.2, previousContact: 0.2 },
        ),
      }),
    );
    // sector lifts 0.4 × 0.05 = 0.020; size lifts 0.1 × 0.35 = 0.035.
    assert.equal(highlights[0].label, "Size");
  });

  it("gives a check with nothing on record no share of the lift", () => {
    const highlights = scoreHighlights(
      org({ score_factors: factors({ size: 0.9 }) }),
    );
    assert.ok(!highlights.some((highlight) => highlight.label === "Sector"));
    assert.ok(!highlights.some((highlight) => highlight.label === "Geography"));
    // The old composition maths handed every neutral check a fifth of the
    // score under equal weights; nothing here may inherit that.
    assert.equal(highlights.length, 1);
  });

  it("counts matched grants, and counts one of them singular", () => {
    const one = scoreHighlights(
      org({
        facts: { matchedGrantCount: 1 },
        score_factors: factors({ partnershipHistory: 0.6 }),
      }),
    );
    assert.equal(one[0].label, "1 matched grant");
    const six = scoreHighlights(
      org({
        facts: { matchedGrantCount: 6 },
        score_factors: factors({ partnershipHistory: 0.9 }),
      }),
    );
    assert.equal(six[0].label, "6 matched grants");
  });

  it("claims a priority sector or area only above the helping cut", () => {
    const strong = scoreHighlights(
      org({ sector: "Education", city: "Leeds", score_factors: factors({ sector: 0.7, geography: 0.7 }) }),
    );
    assert.deepEqual(
      strong.map((highlight) => highlight.label),
      ["Education is a priority sector", "Leeds is a priority area"],
    );
    const slight = scoreHighlights(
      org({ sector: "Education", city: "Leeds", score_factors: factors({ sector: 0.52, geography: 0.52 }) }),
    );
    assert.deepEqual(
      slight.map((highlight) => highlight.label),
      ["Works in Education", "Based in Leeds"],
    );
  });

  it("caps at three lines", () => {
    const highlights = scoreHighlights(
      org({
        score_factors: factors({
          sector: 0.7,
          geography: 0.9,
          size: 0.9,
          partnershipHistory: 0.66,
          previousContact: 0.8,
        }),
      }),
    );
    assert.equal(highlights.length, 3);
  });

  it("reports honest strengths, and no share, when nothing is lifting", () => {
    const highlights = scoreHighlights(
      org({ score_factors: factors({ sector: 0.4, size: 0.45 }) }),
    );
    assert.ok(highlights.length > 0);
    assert.ok(highlights.every((highlight) => highlight.sharePct === null));
    assert.ok(
      highlights.every((highlight) =>
        ["middling", "weak", "very weak"].includes(highlight.strength ?? ""),
      ),
    );
  });

  it("falls back to sector and city when there is no breakdown", () => {
    assert.deepEqual(scoreHighlights(org({ sector: "Healthcare", city: "Sheffield" })), [
      { label: "Works in Healthcare", strength: null, sharePct: null },
      { label: "Based in Sheffield", strength: null, sharePct: null },
    ]);
  });

  it("voids the breakdown on malformed numbers rather than reweighting", () => {
    const highlights = scoreHighlights(
      org({
        sector: "Healthcare",
        score_factors: {
          factors: { sector: 0.9, geography: 0.5, size: 0.5, partnershipHistory: 0.5, previousContact: 0.5 },
          weights: { sector: Number.NaN, geography: 0.2, size: 0.2, partnershipHistory: 0.2, previousContact: 0.2 },
        } as unknown as OpportunityRow["score_factors"],
      }),
    );
    assert.deepEqual(highlights, [
      { label: "Works in Healthcare", strength: null, sharePct: null },
    ]);
  });

  it("never leaks factor keys or table language", () => {
    const highlights = scoreHighlights(
      org({
        sector: "Education",
        outreach_status: "no_response",
        facts: { incomeGBP: 90_000 },
        score_factors: factors({ sector: 0.7, size: 0.9 }),
      }),
    );
    for (const highlight of highlights) {
      assert.doesNotMatch(
        highlight.label,
        /score_factors|priority_|latest_scores|trading_name|not_contacted|no_response/i,
      );
    }
  });
});

describe("scoreGaps", () => {
  it("names what the score could not read, in the record's words", () => {
    const gaps = scoreGaps(
      org({
        score_factors: {
          ...factors({ sector: 0.7 }),
          readings: { sector: true, geography: false, size: false, previousContact: true },
        },
      }),
    );
    assert.deepEqual(gaps, ["No town or city recorded", "No accounts filed", "No matched grants"]);
  });

  it("falls back to the neutral value for rows written before the flags", () => {
    const gaps = scoreGaps(org({ score_factors: factors({ sector: 0.7, size: 0.9 }) }));
    assert.deepEqual(gaps, [
      "No town or city recorded",
      "No matched grants",
      "No outreach recorded",
    ]);
  });

  it("says nothing when there is no breakdown to read", () => {
    assert.deepEqual(scoreGaps(org()), []);
  });
});

describe("applyOpportunityFacts", () => {
  it("rebuilds the lines of the ranked few once their figures arrive", () => {
    const ranked = selectPriorityOpportunities([
      org({ id: "a", score_factors: factors({ size: 0.9 }) }),
    ]);
    assert.equal(ranked[0].highlights[0].label, "Size");

    const withFacts = applyOpportunityFacts(
      ranked,
      new Map([["a", { incomeGBP: 250_000, incomePeriodEnd: "2025-12-31" }]]),
    );
    assert.equal(withFacts[0].highlights[0].label, "£250k income (2025 accounts)");
  });

  it("leaves an opportunity alone when no figures came back for it", () => {
    const ranked = selectPriorityOpportunities([
      org({ id: "a", score_factors: factors({ size: 0.9 }) }),
    ]);
    assert.deepEqual(applyOpportunityFacts(ranked, new Map()), ranked);
  });
});
