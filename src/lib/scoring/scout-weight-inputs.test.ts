import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  anyWeightCounts,
  autoBalanceWeights,
  SCOUT_WEIGHT_PARAMETERS,
  weightShares,
  readWeightsForm,
  scoutWeightsFormSchema,
  toFractions,
  toPercentages,
  validateWeightsForm,
  weightFieldName,
  weightsEqual,
} from "./scout-weight-inputs.ts";

function formFrom(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

const completeForm = {
  weight_sector: "20",
  weight_geography: "20",
  weight_size: "20",
  weight_partnershipHistory: "20",
  weight_previousContact: "20",
};

describe("scout weight inputs — form contract", () => {
  it("keeps the zod schema keys in sync with the rendered parameter list", () => {
    // A parameter added to the UI list but not the schema would be silently
    // dropped by validation (and vice versa would never reach the screen).
    assert.deepEqual(
      new Set(SCOUT_WEIGHT_PARAMETERS.map((p) => p.key)),
      new Set(Object.keys(scoutWeightsFormSchema.shape)),
    );
  });

  it("reads exactly the five named fields and nothing else", () => {
    const formData = formFrom({ ...completeForm, injected: "<script>" });
    const raw = readWeightsForm(formData);
    assert.deepEqual(Object.keys(raw).sort(), [
      "geography",
      "partnershipHistory",
      "previousContact",
      "sector",
      "size",
    ]);
  });

  it("names fields predictably from parameter keys", () => {
    assert.equal(weightFieldName("partnershipHistory"), "weight_partnershipHistory");
  });
});

describe("scout weight inputs — validation", () => {
  it("accepts a complete submission", () => {
    const result = validateWeightsForm(readWeightsForm(formFrom(completeForm)));
    assert.equal(result.success, true);
  });

  it("rejects an empty field as that field's error, not a silent zero", () => {
    const result = validateWeightsForm(
      readWeightsForm(formFrom({ ...completeForm, weight_sector: "  " })),
    );
    assert.notEqual(result.success, true);
    if (!result.success) {
      assert.match(result.fieldErrors.sector?.[0] ?? "", /number/);
    }
  });

  it("rejects values below 0 or above 100 with per-field messages", () => {
    const result = validateWeightsForm(
      readWeightsForm(
        formFrom({ ...completeForm, weight_size: "-5", weight_sector: "140" }),
      ),
    );
    assert.notEqual(result.success, true);
    if (!result.success) {
      assert.match(result.fieldErrors.size?.[0] ?? "", /below 0/);
      assert.match(result.fieldErrors.sector?.[0] ?? "", /above 100/);
    }
  });

  it("accepts decimal percentages", () => {
    const result = validateWeightsForm(
      readWeightsForm(formFrom({ ...completeForm, weight_sector: "33.3" })),
    );
    assert.equal(result.success, true);
  });
});

describe("scout weight inputs — conversions", () => {
  it("converts percentages to 0-1 fractions", () => {
    const fractions = toFractions({
      sector: 50,
      geography: 25,
      size: 12.5,
      partnershipHistory: 10,
      previousContact: 2.5,
    });
    assert.equal(fractions.sector, 0.5);
    assert.equal(fractions.geography, 0.25);
    assert.equal(fractions.size, 0.125);
    assert.equal(fractions.partnershipHistory, 0.1);
    assert.equal(fractions.previousContact, 0.025);
  });

  it("round-trips fractions back to readable percentages", () => {
    const percentages = toPercentages({ sector: 0.333, geography: 0.2 });
    assert.equal(percentages.sector, 33.3);
    assert.equal(percentages.geography, 20);
  });

  it("treats non-numeric display input as 0 rather than NaN-ing the panel", () => {
    assert.equal(toPercentages({ sector: null }).sector, 0);
  });
});

describe("scout weight inputs — shares and the all-zero guard", () => {
  const equal = { sector: 20, geography: 20, size: 20, partnershipHistory: 20, previousContact: 20 };

  it("reports each weight's share of the whole, even when weights do not add to 100", () => {
    const shares = weightShares({ ...equal, sector: 60 });
    assert.equal(Math.round(shares.sector), 43);
    assert.equal(Math.round(shares.geography), 14);
  });

  it("gives every factor no share when nothing counts", () => {
    const zero = { sector: 0, geography: 0, size: 0, partnershipHistory: 0, previousContact: 0 };
    assert.equal(weightShares(zero).sector, 0);
    assert.equal(anyWeightCounts(zero), false);
  });

  it("allows a single factor to carry the whole score", () => {
    assert.equal(
      anyWeightCounts({ sector: 0, geography: 5, size: 0, partnershipHistory: 0, previousContact: 0 }),
      true,
    );
  });
});

describe("scout weight inputs — autoBalanceWeights", () => {
  it("keeps already balanced weights unchanged", () => {
    const equal = { sector: 20, geography: 20, size: 20, partnershipHistory: 20, previousContact: 20 };
    const balanced = autoBalanceWeights(equal);
    assert.deepEqual(balanced, equal);
  });

  it("scales arbitrary positive weights to sum to exactly 100", () => {
    const input = { sector: 40, geography: 20, size: 10, partnershipHistory: 10, previousContact: 10 };
    const balanced = autoBalanceWeights(input);
    const sum = Object.values(balanced).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
    assert.equal(balanced.sector, 45);
    assert.equal(balanced.geography, 22);
    assert.equal(balanced.size, 11);
    assert.equal(balanced.partnershipHistory, 11);
    assert.equal(balanced.previousContact, 11);
  });

  it("falls back to equal 20% weights when all inputs are 0", () => {
    const zero = { sector: 0, geography: 0, size: 0, partnershipHistory: 0, previousContact: 0 };
    const balanced = autoBalanceWeights(zero);
    const sum = Object.values(balanced).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
    assert.deepEqual(balanced, { sector: 20, geography: 20, size: 20, partnershipHistory: 20, previousContact: 20 });
  });
});

describe("scout weight inputs — no-op detection", () => {
  it("calls equal-weight sets equal regardless of float noise below 0.1%", () => {
    const a = { sector: 0.2, geography: 0.2, size: 0.2, partnershipHistory: 0.2, previousContact: 0.2 };
    const b = { sector: 0.20000001, geography: 0.2, size: 0.2, partnershipHistory: 0.2, previousContact: 0.19999999 };
    assert.equal(weightsEqual(a, b), true);
  });

  it("calls genuinely different weights unequal", () => {
    const a = { sector: 0.4, geography: 0.15, size: 0.15, partnershipHistory: 0.15, previousContact: 0.15 };
    const b = { sector: 0.2, geography: 0.2, size: 0.2, partnershipHistory: 0.2, previousContact: 0.2 };
    assert.equal(weightsEqual(a, b), false);
  });

  it("never reports a no-op for incomplete data rather than throwing", () => {
    // Missing keys are unreadable, not equal — a false "unchanged" here would
    // skip the rescore sweep, so the safe answer is false.
    assert.equal(weightsEqual({}, {}), false);
    assert.equal(weightsEqual({ sector: 0.2 }, { sector: 0.2 }), false);
  });
});
