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
} from "./build-prompt.ts";

// AC2: generation "may take several seconds" — this is generous headroom above
// that, not a target latency. Keeps a hung upstream call from leaving the CAM's
// loading state stuck indefinitely (AC3).
const TIMEOUT_MS = 30_000;

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
}) => Promise<string>;

export interface GenerateBookletDeps {
  callGemini: CallGeminiFn;
}

function realCallGemini(): CallGeminiFn {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) {
    throw new Error("GEMINI_API_KEY and GEMINI_MODEL must both be set to generate a booklet.");
  }
  const google = createGoogleGenerativeAI({ apiKey });

  return async ({ system, prompt, timeoutMs }) => {
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
    return text;
  };
}

export function createDefaultGenerateBookletDeps(): GenerateBookletDeps {
  return { callGemini: realCallGemini() };
}

export type GenerateBookletInput = {
  organisationId: string;
  organisation: BookletOrganisationInput;
  enrichment: BookletEnrichmentInput;
};

/**
 * Runs the full generate-a-booklet call: builds the prompt, calls Gemini via the
 * injected dependency, logs to API_HEALTH_LOGS either way, and reports a failure to
 * ERROR_LOG. Never throws — same contract shape as
 * detectAndFlagDiscrepancies: the caller (the API route) turns the result into a
 * response, it doesn't need its own try/catch around this.
 */
export async function generateBooklet(
  input: GenerateBookletInput,
  deps: GenerateBookletDeps,
): Promise<{ booklet: string } | { error: string }> {
  const { system, prompt } = buildBookletPrompt(input.organisation, input.enrichment);
  const startedAt = Date.now();

  try {
    const text = await deps.callGemini({ system, prompt, timeoutMs: TIMEOUT_MS });
    const booklet = text.trim();
    if (!booklet) {
      // Treated as a failure, not success-with-nothing-to-show: AC3 wants a clear
      // error and a retry, not a booklet section that silently renders blank.
      throw new Error("Gemini returned an empty response.");
    }
    logApiHealth("gemini", "booklet.generate", true, startedAt, {
      organisationId: input.organisationId,
    });
    return { booklet };
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
