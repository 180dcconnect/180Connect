// F082 — Generate Client Booklet: the Gemini-calling wrapper around
// build-prompt.ts's pure prompt, behind an injectable `callGemini` (same DI
// reasoning as discrepancies/detect-field-discrepancies.ts's DiscrepancyDetectionStore)
// so tests fake the LLM call directly rather than mocking fetch or the AI SDK.
//
// No auto-retry loop here: AC3 asks for a clear error and a CAM-initiated retry,
// not a server-side retry that could silently double the API cost of a single
// click. generateText's own maxRetries still covers a dropped connection — that's
// the same class of transient failure fetchWithRetry (ingestion/sources/*.ts)
// retries, not a second full attempt at generation.

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { reportError } from "../error-logging.ts";
import { logApiHealth } from "../api-health-log.ts";
import {
  buildBookletPrompt,
  type BookletEnrichmentInput,
  type BookletOrganisationInput,
  type BookletWebsiteContext,
} from "./build-prompt.ts";

// PRD §"Performance and Reliability Targets": Client Booklet generation is ordinarily
// ≤45s, hard timeout 90s. This is the hard timeout, not the target — a legitimate
// 46-89s generation must still succeed, not be cut off at an arbitrary tighter value.
// Route.ts's own maxDuration must stay comfortably above this or the hosting
// platform kills the request before this timeout gets the chance to return its own
// clear error.
const TIMEOUT_MS = 90_000;

// Belt-and-suspenders with the system prompt's own "~250 words" instruction: the
// prompt asks nicely, this caps it at the API level so a model that ignores the
// instruction still can't run the bill up. See the LLM Provider Research doc's
// note on capping prompt/output size.
//
// This is much larger than the ~250-word target (roughly 350-400 tokens of
// English prose) implies on its own. Confirmed by hand against the real API
// (2026-08-16): some Gemini models (gemini-flash-latest, at the time) spend
// several hundred output tokens on hidden "thinking" before writing anything,
// with no reliable way to switch that off across every model GEMINI_MODEL might
// point to (see the removed thinkingConfig note below) — so a tighter cap here
// risks truncating the visible booklet mid-sentence (finishReason "length")
// rather than limiting cost the way it's meant to. 2048 was the smallest value
// that reliably left the visible text a clean finishReason "stop" on a
// thinking-model across repeated real calls; do not lower this without
// re-checking finishReason on a live call, not just reading this comment.
const MAX_OUTPUT_TOKENS = 2048;

export type CallGeminiFn = (input: {
  system: string;
  prompt: string;
  timeoutMs: number;
}) => Promise<{ text: string; model: string }>;

export interface GenerateBookletDeps {
  callGemini: CallGeminiFn;
}

function realCallGemini(): CallGeminiFn {
  // Deliberately not read/validated here: this factory runs at
  // createDefaultGenerateBookletDeps() time, outside generateBooklet's own try/catch
  // (route.ts constructs deps before calling generateBooklet). A missing env var
  // used to throw right here, synchronously escaping that try/catch entirely — the
  // route returned a raw 500 with no ERROR_LOG entry, no API_HEALTH_LOGS entry, and
  // none of AC3's clear-error-plus-retry contract, exactly backwards from the
  // point of this file. Reading and validating inside the returned closure instead
  // means the throw happens when deps.callGemini(...) is actually invoked — inside
  // generateBooklet's try block — so the existing catch handles it like any other
  // upstream failure. Confirmed in review (PR #368) rather than caught locally.
  return async ({ system, prompt, timeoutMs }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;
    if (!apiKey || !model) {
      throw new Error("GEMINI_API_KEY and GEMINI_MODEL must both be set to generate a booklet.");
    }
    const google = createGoogleGenerativeAI({ apiKey });

    const { text } = await generateText({
      model: google(model),
      system,
      prompt,
      timeout: timeoutMs,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Deliberately not setting providerOptions.google.thinkingConfig: it's the
      // documented way to ask a model for zero thinking budget, but confirmed by
      // hand against the real API (2026-08-16) that not every Gemini model
      // accepts it — gemini-3.5-flash-lite 400s on the request entirely if it's
      // present, rather than ignoring it. GEMINI_MODEL is meant to be swapped
      // freely (see its env.ts entry), so a provider option that only some
      // models tolerate can't be hardcoded here. MAX_OUTPUT_TOKENS's headroom is
      // the actual defence against a thinking-model truncating its output.
    });
    return { text, model };
  };
}

export function createDefaultGenerateBookletDeps(): GenerateBookletDeps {
  return { callGemini: realCallGemini() };
}

export type GenerateBookletInput = {
  organisationId: string;
  organisation: BookletOrganisationInput;
  enrichment: BookletEnrichmentInput;
  // F084: pre-fetched by the caller (route.ts) before generateBooklet is ever
  // called, same way organisation/enrichment are already DB reads the route does
  // up front — keeps this function's own concern limited to the Gemini call.
  websiteContext?: BookletWebsiteContext;
};

/**
 * Runs the full generate-a-booklet call: builds the prompt, calls Gemini via the
 * injected dependency, logs to API_HEALTH_LOGS either way, and reports a failure to
 * ERROR_LOG. Never throws — same contract shape as
 * detectAndFlagDiscrepancies: the caller (the API route) turns the result into a
 * response, it doesn't need its own try/catch around this.
 *
 * On success the exact prompt sent and the model id are returned alongside the
 * text so the route can write the F112 audit row (booklet_generations) — the
 * prompt is built here, so it travels out from here rather than being rebuilt at
 * the insert site where it could drift from what was actually sent.
 */
export async function generateBooklet(
  input: GenerateBookletInput,
  deps: GenerateBookletDeps,
): Promise<
  | {
      booklet: string;
      model: string;
      systemPrompt: string;
      userPrompt: string;
    }
  | { error: string }
> {
  const { system, prompt } = buildBookletPrompt(
    input.organisation,
    input.enrichment,
    input.websiteContext ?? null,
  );
  const startedAt = Date.now();

  try {
    const { text, model } = await deps.callGemini({ system, prompt, timeoutMs: TIMEOUT_MS });
    const booklet = text.trim();
    if (!booklet) {
      // Treated as a failure, not success-with-nothing-to-show: AC3 wants a clear
      // error and a retry, not a booklet section that silently renders blank.
      throw new Error("Gemini returned an empty response.");
    }
    logApiHealth("gemini", "booklet.generate", true, startedAt, {
      organisationId: input.organisationId,
    });
    return { booklet, model, systemPrompt: system, userPrompt: prompt };
  } catch (error) {
    logApiHealth("gemini", "booklet.generate", false, startedAt, {
      organisationId: input.organisationId,
    });
    await reportError(error instanceof Error ? error : new Error(String(error)), {
      operation: "clients.generate_booklet",
      organisationId: input.organisationId,
    });
    return { error: "The booklet could not be generated. Try again." };
  }
}
