// F214 — Natural Language Charity Search (#209): the Gemini-calling half.
//
// Same shape as booklet/generate-booklet.ts — an injectable `callGemini` so
// tests fake the model rather than the AI SDK or fetch, API_HEALTH_LOGS written
// on both outcomes, ERROR_LOG on failure, and never throws: the caller turns the
// result into a page, it does not need its own try/catch.
//
// Two things differ from the booklet, both because a search is not a generation:
//
//   * No retry, and a short timeout. A booklet is worth waiting 90 seconds for;
//     a search is not worth waiting 12. Past that the CAM is better served by
//     AC3's "the interpretation failed, here are your filters" than by a spinner.
//   * A cheaper model. The LLM Provider Research doc puts NL search on the
//     Flash-Lite tier and email drafts/booklets on Flash; at $0.30/$2.50 per
//     million against $0.75/$3.75, running search on the booklet's model would
//     cost roughly two and a half times as much for a job that is strictly
//     easier. GEMINI_SEARCH_MODEL exists so the two can be set apart.

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { reportError } from "../error-logging.ts";
import { logApiHealth } from "../api-health-log.ts";
import { getCachedPlan, setCachedPlan } from "./nl-plan-cache.ts";
import { normaliseQuery } from "./nl-query-shape.ts";
import {
  buildNlSearchPrompt,
  MAX_QUERY_LENGTH,
  NL_SEARCH_SYSTEM_PROMPT,
  parseNlSearchPlan,
  type NlSearchPlan,
} from "./nl-search-plan.ts";

/**
 * Hard ceiling on one interpretation. Well inside any hosting request budget, so
 * the CAM gets this file's clear error rather than the platform's blank 504.
 */
export const TIMEOUT_MS = 12_000;

/**
 * The plan is a small flat JSON object — a few dozen tokens of actual answer.
 * The headroom above that is for hidden "thinking" tokens, which Flash-tier
 * models spend before writing anything and which count against this same cap
 * (see the long note in booklet/generate-booklet.ts, confirmed against the real
 * API). Too tight and the JSON truncates mid-object, which reads here as a
 * failed interpretation on every single call rather than as a cost saving.
 */
export const MAX_OUTPUT_TOKENS = 512;

export type CallSearchModelFn = (input: {
  system: string;
  prompt: string;
  timeoutMs: number;
}) => Promise<{
  text: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}>;

export interface InterpretQueryDeps {
  callSearchModel: CallSearchModelFn;
}

/**
 * Which model interprets searches. Falls back to GEMINI_MODEL rather than
 * refusing to run, so the feature works on an environment that has not been
 * told about it yet — but says so once per process, because that fallback is
 * the expensive tier and a silent 2.5x on every search is exactly the kind of
 * cost drift nobody notices.
 */
let warnedAboutModelFallback = false;

export function resolveSearchModel(
  source: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = source.GEMINI_SEARCH_MODEL?.trim();
  if (explicit) return explicit;
  const fallback = source.GEMINI_MODEL?.trim();
  if (!fallback) return null;
  if (!warnedAboutModelFallback) {
    warnedAboutModelFallback = true;
    console.warn(
      "[nl-search] GEMINI_SEARCH_MODEL is unset; falling back to GEMINI_MODEL " +
        `(${fallback}). Set a Flash-Lite-tier model to cut search cost.`,
    );
  }
  return fallback;
}

function realCallSearchModel(): CallSearchModelFn {
  // Env read inside the closure, not in this factory — the same bug fixed in
  // generate-booklet.ts (PR #368): reading it here would throw outside the
  // caller's try/catch, producing a raw 500 with no ERROR_LOG entry and none of
  // AC3's clear-error contract.
  return async ({ system, prompt, timeoutMs }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = resolveSearchModel();
    if (!apiKey || !model) {
      throw new Error(
        "GEMINI_API_KEY and GEMINI_SEARCH_MODEL (or GEMINI_MODEL) must be set to interpret a search.",
      );
    }
    const google = createGoogleGenerativeAI({ apiKey });
    const { text, usage } = await generateText({
      model: google(model),
      system,
      prompt,
      timeout: timeoutMs,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // A translation, not a composition: the same sentence should map to the
      // same filters every time, and a plan that wobbles between renders would
      // make the cache actively misleading.
      temperature: 0,
    });
    return {
      text,
      model,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    };
  };
}

export function createDefaultInterpretQueryDeps(): InterpretQueryDeps {
  return { callSearchModel: realCallSearchModel() };
}

export type InterpretQueryResult =
  | { plan: NlSearchPlan; cached: boolean }
  | { error: string };

/**
 * The CAM-facing failure text. One message for every upstream failure — timeout,
 * missing key, quota, malformed response — because none of the differences are
 * ones a CAM can act on, and the parts that *are* different (the exception, the
 * operation) go to ERROR_LOG where someone can. No stack traces, no provider
 * names, no key hints (DoD: user-facing errors expose neither).
 */
export const INTERPRETATION_FAILED_MESSAGE =
  "We couldn't interpret that search just now. Use the filters below, or try again.";

/**
 * Interprets one plain-English query. Never throws.
 *
 * Cache first, and the cache is checked before any spend decision: a repeat of a
 * query someone already paid for costs nothing, which is what makes paginating a
 * result set free.
 */
export async function interpretQuery(
  query: string,
  deps: InterpretQueryDeps,
): Promise<InterpretQueryResult> {
  const key = normaliseQuery(query);
  const cached = getCachedPlan(key);
  if (cached) return { plan: cached, cached: true };

  const system = NL_SEARCH_SYSTEM_PROMPT;
  const prompt = buildNlSearchPrompt(query.slice(0, MAX_QUERY_LENGTH));
  const startedAt = Date.now();

  try {
    const { text, model, inputTokens, outputTokens } = await deps.callSearchModel({
      system,
      prompt,
      timeoutMs: TIMEOUT_MS,
    });
    const plan = parseNlSearchPlan(text);
    if (!plan) {
      // A response that is not a plan is a failed call, not an empty search:
      // showing the unfiltered list as though the query had been understood
      // would be the one outcome AC2 rules out.
      throw new Error("The search model did not return a usable filter plan.");
    }
    // Token counts, never the query text or the plan: API_HEALTH_LOGS records
    // that a call happened and what it cost, not what anyone searched for.
    logApiHealth("gemini", "search.interpret_query", true, startedAt, {
      model,
      inputTokens: inputTokens ?? undefined,
      outputTokens: outputTokens ?? undefined,
    });
    setCachedPlan(key, plan);
    return { plan, cached: false };
  } catch (error) {
    logApiHealth("gemini", "search.interpret_query", false, startedAt, {
      queryLength: query.length,
    });
    await reportError(error instanceof Error ? error : new Error(String(error)), {
      operation: "clients.nl_search_interpret",
      // Length, not content: a search query is user data and ERROR_LOG is not
      // where it belongs.
      queryLength: query.length,
    });
    return { error: INTERPRETATION_FAILED_MESSAGE };
  }
}
