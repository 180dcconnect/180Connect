// F214 — Natural Language Charity Search (#209): the orchestration one step
// above the model call. Decides whether a query is worth paying to interpret,
// spends the allowance if so, and grounds whatever comes back in real data.
//
// Kept out of the page component and behind injected dependencies so the order
// of those decisions — which is where both the cost story and AC3's failure
// story live — is testable without a database, a session or an API key.

import {
  consumeAiGenerationAllowance,
  getAiSearchRateLimitConfig,
  SEARCH_BUCKET,
  type AiRateLimitConfig,
  type AiRateLimitRpcClient,
} from "../ai/rate-limit.ts";
import {
  createDefaultInterpretQueryDeps,
  interpretQuery,
  type InterpretQueryResult,
} from "./interpret-query.ts";
import { getCachedPlan } from "./nl-plan-cache.ts";
import { looksLikeNaturalLanguage, normaliseQuery } from "./nl-query-shape.ts";
import { MAX_QUERY_LENGTH } from "./nl-search-plan.ts";
import { resolveNlPlan, type ResolvedNlPlan } from "./nl-search-apply.ts";

export type NlSearchOutcome =
  /** Short enough, or plain enough, to be a name. Costs nothing and falls
   *  through to F052's substring search — which the UI says out loud, so a CAM
   *  is never left wondering why their sentence was taken literally. */
  | { kind: "literal"; query: string }
  | { kind: "interpreted"; query: string; plan: ResolvedNlPlan; cached: boolean }
  /** AC3 — the interpretation failed or was refused. The list still renders
   *  under whatever manual filters are set; only the narrowing this query would
   *  have added is missing. */
  | { kind: "error"; query: string; message: string };

export type NlSearchVocabulary = {
  cities: string[];
  countryCodes: string[];
};

export type RunNlSearchDeps = {
  interpret: (query: string) => Promise<InterpretQueryResult>;
  /** Null when no service-role client is available: the allowance cannot be
   *  consumed, so — failing closed, as everywhere else that guards a paid API —
   *  no call is made. */
  rateLimitClient: AiRateLimitRpcClient | null;
  rateLimitConfig?: AiRateLimitConfig;
};

export function createDefaultRunNlSearchDeps(
  rateLimitClient: AiRateLimitRpcClient | null,
): RunNlSearchDeps {
  const deps = createDefaultInterpretQueryDeps();
  return {
    interpret: (query) => interpretQuery(query, deps),
    rateLimitClient,
  };
}

export const SEARCH_UNAVAILABLE_MESSAGE =
  "Search interpretation is unavailable right now. Use the filters below.";

/**
 * Runs one plain-English search. Returns null when there is nothing to run.
 *
 * The order below is the cost control, and it is deliberate:
 *   1. Nothing to search — free.
 *   2. Doesn't read like a question — free, falls back to name search.
 *   3. Someone already asked this — free, served from cache. Crucially this is
 *      checked *before* the allowance is consumed, so paging through results
 *      neither costs money nor burns a CAM's daily search budget.
 *   4. Only now is an allowance spent and the model called.
 */
export async function runNlSearch(
  rawQuery: string | null | undefined,
  vocabulary: NlSearchVocabulary,
  deps: RunNlSearchDeps,
  userId: string,
): Promise<NlSearchOutcome | null> {
  const query = rawQuery?.trim().slice(0, MAX_QUERY_LENGTH) ?? "";
  if (!query) return null;

  if (!looksLikeNaturalLanguage(query)) {
    return { kind: "literal", query };
  }

  const cached = getCachedPlan(normaliseQuery(query));
  if (cached) {
    return {
      kind: "interpreted",
      query,
      plan: resolveNlPlan(cached, vocabulary.cities, vocabulary.countryCodes),
      cached: true,
    };
  }

  if (!deps.rateLimitClient) {
    return { kind: "error", query, message: SEARCH_UNAVAILABLE_MESSAGE };
  }

  const allowance = await consumeAiGenerationAllowance(
    deps.rateLimitClient,
    userId,
    deps.rateLimitConfig ?? getAiSearchRateLimitConfig(),
    new Date(),
    SEARCH_BUCKET,
  );
  if (!allowance.allowed) {
    return { kind: "error", query, message: allowance.message };
  }

  const result = await deps.interpret(query);
  if ("error" in result) {
    return { kind: "error", query, message: result.error };
  }

  return {
    kind: "interpreted",
    query,
    plan: resolveNlPlan(result.plan, vocabulary.cities, vocabulary.countryCodes),
    cached: result.cached,
  };
}
