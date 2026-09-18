import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SCOUT_CHECKS,
  SCOUT_HELPING_CUT,
  SCOUT_NO_READING,
  scoutContributions,
  scoutLiftShares,
  scoutReadingFor,
  scoutVerdictFor,
} from "./scout-checks.ts";

describe("SCOUT_CHECKS", () => {
  it("names the five checks once, in engine order", () => {
    assert.deepEqual(
      SCOUT_CHECKS.map((check) => check.key),
      ["sector", "geography", "size", "partnershipHistory", "previousContact"],
    );
    assert.deepEqual(
      SCOUT_CHECKS.map((check) => check.label),
      ["Sector", "Geography", "Size", "Partnership history", "Previous contact"],
    );
  });
});

describe("scoutVerdictFor", () => {
  it("reads absence as absence, not as a dimmer value", () => {
    assert.equal(scoutVerdictFor(SCOUT_NO_READING).label, "Nothing on record");
  });

  it("calls values above the helping cut helpers", () => {
    assert.equal(scoutVerdictFor(SCOUT_HELPING_CUT + 0.01).label, "Helping the score");
    assert.equal(scoutVerdictFor(SCOUT_HELPING_CUT).label, "Neither way");
  });

  it("marks weak inputs as holding back, not errors", () => {
    assert.equal(scoutVerdictFor(0.3).label, "Holding it back");
  });
});

describe("scoutReadingFor", () => {
  it("grades strength, not just direction", () => {
    assert.equal(scoutReadingFor("Income size", 0.9), "Income size: strong.");
    assert.equal(scoutReadingFor("Income size", 0.6), "Income size: above average.");
    assert.equal(scoutReadingFor("Income size", 0.5), "Income size: middling.");
    assert.equal(scoutReadingFor("Income size", 0.3), "Income size: weak.");
    assert.equal(scoutReadingFor("Income size", 0.1), "Income size: very weak.");
  });
});

describe("scoutContributions", () => {
  it("splits the score weight-aware, summing to 100", () => {
    const shares = scoutContributions({
      factors: { sector: 0.7, geography: 0.5, size: 0.9, partnershipHistory: 0.5, previousContact: 0.8 },
      weights: { sector: 0.2, geography: 0.2, size: 0.2, partnershipHistory: 0.2, previousContact: 0.2 },
    });
    const total = shares.reduce((sum, share) => sum + share.percent, 0);
    assert.ok(Math.abs(total - 100) < 1e-9, `shares sum to ${total}`);
    // Size outranks sector: same weight, stronger reading.
    const byKey = new Map(shares.map((share) => [share.key, share.percent]));
    assert.ok((byKey.get("size") ?? 0) > (byKey.get("sector") ?? 0));
  });

  it("lets a heavy weight outweigh a stronger reading", () => {
    const shares = scoutContributions({
      factors: { sector: 0.9, geography: 0.5, size: 0.5, partnershipHistory: 0.5, previousContact: 0.5 },
      weights: { sector: 0.05, geography: 0.2, size: 0.35, partnershipHistory: 0.2, previousContact: 0.2 },
    });
    const byKey = new Map(shares.map((share) => [share.key, share.percent]));
    // 0.9 × 0.05 loses to 0.5 × 0.35 — the ranking the cards must use.
    assert.ok((byKey.get("size") ?? 0) > (byKey.get("sector") ?? 0));
  });
});

describe("scoutLiftShares", () => {
  it("gives a check with nothing on record none of the lift", () => {
    const shares = new Map(
      scoutLiftShares({
        factors: { sector: 0.7, geography: 0.5, size: 0.9, partnershipHistory: 0.5, previousContact: 0.5 },
        weights: { sector: 0.2, geography: 0.2, size: 0.2, partnershipHistory: 0.2, previousContact: 0.2 },
      }).map((share) => [share.key, share.percent]),
    );
    // What composition maths gets wrong under this heading: the same row
    // through scoutContributions hands geography a fifth of the score.
    assert.equal(shares.get("geography"), 0);
    assert.equal(shares.get("partnershipHistory"), 0);
    assert.ok((shares.get("size") ?? 0) > (shares.get("sector") ?? 0));
  });

  it("gives a check holding the score back none of the lift either", () => {
    const shares = new Map(
      scoutLiftShares({
        factors: { sector: 0.1, geography: 0.5, size: 0.9, partnershipHistory: 0.5, previousContact: 0.5 },
        weights: { sector: 0.2, geography: 0.2, size: 0.2, partnershipHistory: 0.2, previousContact: 0.2 },
      }).map((share) => [share.key, share.percent]),
    );
    assert.equal(shares.get("sector"), 0);
    assert.equal(shares.get("size"), 100);
  });

  it("sums to 100 across the checks that are lifting", () => {
    const total = scoutLiftShares({
      factors: { sector: 0.7, geography: 0.6, size: 0.9, partnershipHistory: 0.5, previousContact: 0.8 },
      weights: { sector: 0.1, geography: 0.3, size: 0.2, partnershipHistory: 0.2, previousContact: 0.2 },
    }).reduce((sum, share) => sum + share.percent, 0);
    assert.ok(Math.abs(total - 100) < 1e-9, `lift shares sum to ${total}`);
  });

  it("weighs lift, not raw reading: a heavy check can outrank a stronger one", () => {
    const shares = new Map(
      scoutLiftShares({
        factors: { sector: 0.9, geography: 0.5, size: 0.6, partnershipHistory: 0.5, previousContact: 0.5 },
        weights: { sector: 0.05, geography: 0.2, size: 0.35, partnershipHistory: 0.2, previousContact: 0.2 },
      }).map((share) => [share.key, share.percent]),
    );
    // sector: 0.4 × 0.05 = 0.020. size: 0.1 × 0.35 = 0.035.
    assert.ok((shares.get("size") ?? 0) > (shares.get("sector") ?? 0));
  });

  it("apportions nothing when no check is above the neutral", () => {
    const shares = scoutLiftShares({
      factors: { sector: 0.5, geography: 0.4, size: 0.5, partnershipHistory: 0.5, previousContact: 0.3 },
      weights: { sector: 0.2, geography: 0.2, size: 0.2, partnershipHistory: 0.2, previousContact: 0.2 },
    });
    assert.ok(shares.every((share) => share.percent === 0));
  });
});
