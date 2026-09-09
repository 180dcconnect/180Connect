import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadModelRate, type ModelPricingReader } from "./model-rate.ts";

function reader(result: { data: unknown; error: unknown }): ModelPricingReader {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => result as never }),
      }),
    }),
  };
}

describe("loadModelRate", () => {
  it("returns the rate when the model is priced", async () => {
    const rate = await loadModelRate(
      reader({
        data: { input_usd_per_1k_tokens: 0.0003, output_usd_per_1k_tokens: 0.0025 },
        error: null,
      }),
      "gemini-3.5-flash-lite",
      "test.load_pricing",
    );
    assert.deepEqual(rate, { inputUsdPer1kTokens: 0.0003, outputUsdPer1kTokens: 0.0025 });
  });

  it("returns null on a query error rather than throwing — pricing never fails a generation", async () => {
    const rate = await loadModelRate(
      reader({ data: null, error: { message: "boom" } }),
      "m",
      "test.load_pricing",
    );
    assert.equal(rate, null);
  });

  it("returns null when the model simply has no row", async () => {
    // The silent case this helper exists for: an unpriced model used to record a
    // null cost with nothing anywhere saying why.
    const rate = await loadModelRate(reader({ data: null, error: null }), "m", "test.load_pricing");
    assert.equal(rate, null);
  });
});
