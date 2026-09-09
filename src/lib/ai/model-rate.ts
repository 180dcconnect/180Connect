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

/**
 * Just the surface this needs. Typed structurally rather than as SupabaseClient
 * so a test can pass a two-line fake — but with the row shape stated as its own
 * named type, since inlining it made TypeScript walk the full Supabase generic
 * tree at one call site and give up (TS2589).
 */
export type ModelPricingRow = {
  input_usd_per_1k_tokens: number;
  output_usd_per_1k_tokens: number;
};

export type ModelPricingReader = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => PromiseLike<{ data: ModelPricingRow | null; error: unknown }>;
      };
    };
  };
};

/**
 * Best-effort: always resolves, never throws, and returns null whenever the rate
 * is not known — which `computeCostUsd` turns into a null cost rather than a
 * fabricated zero.
 *
 * `operation` names the caller in whatever reaches ERROR_LOG, so a report says
 * which feature was generating when the rate came up missing.
 */
export async function loadModelRate(
  client: ModelPricingReader,
  model: string,
  operation: string,
): Promise<ModelPricingRate | null> {
  const { data, error } = await client
    .from("model_pricing")
    .select("input_usd_per_1k_tokens, output_usd_per_1k_tokens")
    .eq("model", model)
    .maybeSingle();

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
