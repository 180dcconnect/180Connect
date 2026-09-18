// F213 / F214 — one place that reads a model's rate out of MODEL_PRICING.
//
// It exists for the *missing row* case. Four routes used to run this query
// inline, and each reported a query error but said nothing at all when the query
// simply came back empty — so a model with no rate priced as "unknown" in total
// silence. That is the way this table actually goes stale: not a repricing
// (announced in advance, handled by a migration), but someone pointing
// GEMINI_MODEL or GEMINI_SEARCH_MODEL at a new model id, which Google encourages
// by retiring old ones. Every generation from that moment on records a null
// cost, and nothing anywhere says why.
//
// So an unpriced model is reported like any other non-fatal failure. It is not
// an error the request fails on — the generation has already succeeded and a
// missing rate must never cost a CAM their work — but it stops being invisible.

import { reportError } from "../error-logging.ts";
import type { ModelPricingRate } from "../outreach/generation-cost.ts";

/** The two columns this reads. */
export type ModelPricingRow = {
  input_usd_per_1k_tokens: number;
  output_usd_per_1k_tokens: number;
};

/**
 * The caller runs the query and hands the result over.
 *
 * The obvious signature — take the Supabase client and build the query in here —
 * does not survive contact with TypeScript: checking the generated client type
 * against a structural `{ from: … }` shape blows the instantiation-depth limit
 * (TS2589) in the larger route files, and it does so *only on a cold build*, so
 * an incremental local run says everything is fine and CI does not. Taking a
 * thunk means the only type that has to be matched is this small result object,
 * which is cheap to check anywhere.
 *
 * It also keeps the fake in tests down to one line.
 */
export type ModelPricingLookup = () => PromiseLike<{
  data: ModelPricingRow | null;
  error: unknown;
}>;

/**
 * Best-effort: always resolves, never throws, and returns null whenever the rate
 * is not known — which `computeCostUsd` turns into a null cost rather than a
 * fabricated zero.
 *
 * `operation` names the caller in whatever reaches ERROR_LOG, so a report says
 * which feature was generating when the rate came up missing.
 */
export async function loadModelRate(
  lookup: ModelPricingLookup,
  model: string,
  operation: string,
): Promise<ModelPricingRate | null> {
  const { data, error } = await lookup();

  if (error) {
    await reportError(error, { operation, model });
    return null;
  }

  if (!data) {
    await reportError(
      new Error(
        `No MODEL_PRICING row for "${model}" — this model's generations are recording an unknown cost. ` +
          "Add a rate in a migration (see 20260925090100_seed_model_pricing.sql).",
      ),
      { operation, model },
    );
    return null;
  }

  return {
    inputUsdPer1kTokens: data.input_usd_per_1k_tokens,
    outputUsdPer1kTokens: data.output_usd_per_1k_tokens,
  };
}
