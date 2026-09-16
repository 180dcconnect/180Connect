import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
  it("names the helping checks in the record page's words, by share", () => {
    const highlights = scoreHighlights(
      org({
        score_factors: factors({ sector: 0.7, size: 0.9, previousContact: 0.8 }),
      }),
    );
    assert.deepEqual(
      highlights.map((highlight) => highlight.label),
      ["Size", "Previous contact", "Sector"],
    );
    assert.deepEqual(
      highlights.map((highlight) => highlight.strength),
      ["strong", "strong", "above average"],
    );
    for (const highlight of highlights) {
      assert.ok(
        typeof highlight.sharePct === "number" && highlight.sharePct > 0,
        `${highlight.label} carries a share`,
      );
    }
  });

  it("ranks by weight-aware share, not raw factor value", () => {
    const highlights = scoreHighlights(
      org({
        score_factors: factors(
          { sector: 0.9, size: 0.6 },
          { sector: 0.05, geography: 0.2, size: 0.35, partnershipHistory: 0.2, previousContact: 0.2 },
        ),
      }),
    );
    assert.deepEqual(
      highlights.map((highlight) => highlight.label)[0],
      "Size",
    );
  });

  it("skips neutral checks — absence is not a reason", () => {
    const highlights = scoreHighlights(
      org({ score_factors: factors({ size: 0.9 }) }),
    );
    assert.ok(!highlights.some((highlight) => highlight.label === "Sector"));
    assert.ok(!highlights.some((highlight) => highlight.label === "Geography"));
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

  it("reports honest strengths when nothing is actively helping", () => {
    const highlights = scoreHighlights(
      org({ score_factors: factors({ sector: 0.4, size: 0.45 }) }),
    );
    assert.ok(highlights.length > 0);
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
      org({ score_factors: factors({ sector: 0.7, size: 0.9 }) }),
    );
    for (const highlight of highlights) {
      assert.match(highlight.label, /^[A-Z]/);
      assert.doesNotMatch(highlight.label, /score_factors|priority_|latest_scores|trading_name/i);
    }
  });
});
