import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";
import type { StageOneUsage } from "./stage-one-generation.ts";
import { STAGE_ONE_MODEL_OPTIONS } from "./stage-one-generation.ts";
import type { ClosingApproach, EmailLength, EmailRegister, ReplyClosingApproach } from "./stage-one-prompt.ts";
import { buildStageTwoPrompt, type StageTwoContext } from "./stage-two-prompt.ts";

const TIMEOUT_MS = 30_000;

/**
 * Route budget guard for the parse-failure retry below. The stage-two route
 * runs with maxDuration 60s; a retry is only attempted while a second full
 * model call still fits inside ~55s, leaving headroom for the reads and
 * writes around the calls. A slow first attempt therefore fails exactly as
 * before instead of dying at the platform edge mid-retry.
 */
const RETRY_BUDGET_MS = 55_000;

/**
 * A reply has no subject.
 *
 * Stage 2 goes out as a reply on an existing thread, so the subject is already
 * set and the send path composes `Re: <thread subject>` itself. Asking the model
 * for one produced a value that was written to the draft row and then never
 * sent — the reviewed artefact and the sent email disagreed. The contract is
 * therefore the body alone, and the subject is a fact about the thread rather
 * than something generated.
 */
export type StageTwoDraft = { body: string };
// Same shape and semantics as Stage 1's usage: token counts travel back with the
// raw text from the AI SDK response — the only authoritative source — and stay
// `| undefined` until the persistence layer decides how an absent count is stored.
export type StageTwoUsage = StageOneUsage;
export type CallStageTwoModel = (input: {
  system: string;
  prompt: string;
}) => Promise<{ text: string; usage: StageTwoUsage }>;

export function isStageTwoEligible(status: string): boolean {
  return status === "initial_outreach_sent";
}

/**
 * Parses a reply draft out of model output.
 *
 * Tolerant of the same wrappers stage one accepts — a leading sentence, ```json
 * fences, trailing chatter — and of a model that volunteers a "subject" anyway, since
 * "we do not ask for one" should mean the key is ignored, not that an otherwise
 * good draft is thrown away. Strict about the one thing that matters: a single
 * non-empty body string. A truncated response still throws; the retry below
 * exists for exactly that case.
 */
export function parseReplyDraftJson(text: string): StageTwoDraft {
  const trimmed = text.trim();
  const withoutFences = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  const cleaned = start !== -1 && end > start ? withoutFences.slice(start, end + 1) : withoutFences;
  const parsed: unknown = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object") throw new Error("Gemini returned invalid draft JSON.");
  const { body } = parsed as Record<string, unknown>;
  if (typeof body !== "string" || !body.trim()) {
    throw new Error("Gemini returned an incomplete email draft.");
  }
  return { body: body.trim() };
}

// F113 — Track Model Used: `model` travels back out alongside the callable itself,
// read once here from the same env var the call already depends on, so the value
// recorded on ai_generations cannot drift from whichever model actually ran.
export function createStageTwoModelCall(): { callModel: CallStageTwoModel; model: string } {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) throw new Error("Gemini generation is not configured.");
  const google = createGoogleGenerativeAI({ apiKey });
  const callModel: CallStageTwoModel = async ({ system, prompt }) => {
    const result = await generateText({
      model: google(model),
      system,
      prompt,
      timeout: TIMEOUT_MS,
      // Same ceiling and minimal thinking as stage one: without it the model
      // spends the output budget thinking and the email cuts off mid-string
      // (`Unterminated string`) — the exact failure in the stage-one comment.
      ...STAGE_ONE_MODEL_OPTIONS,
    });
    return {
      text: result.text,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  };
  return { callModel, model };
}

// F112 — Save AI Prompt and Output: the exact {system, user} pair sent travels
// back out with the draft, so the ai_generations row can record verbatim what
// the model received — same shape and reasoning as Stage 1's StageOnePromptSent.
export type StageTwoPromptSent = { system: string; user: string };

export async function generateStageTwoDraft(
  organisationId: string,
  context: StageTwoContext,
  callModel: CallStageTwoModel,
  options: {
    length?: EmailLength;
    register?: EmailRegister;
    closing?: ClosingApproach | ReplyClosingApproach;
    newsEnabled?: boolean;
  } = {},
): Promise<
  | { draft: StageTwoDraft; usage: StageTwoUsage; prompt: StageTwoPromptSent }
  | { error: string }
> {
  const prompt = buildStageTwoPrompt(context, options);
  const startedAt = Date.now();
  let firstParseError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let text: string;
    let usage: StageTwoUsage;
    try {
      ({ text, usage } = await callModel(prompt));
    } catch (error) {
      // Transport and timeout failures are not retried: only a completed call
      // whose output failed to parse gets a second sample.
      logApiHealth("gemini", "outreach.stage_two.generate", false, startedAt, { organisationId });
      await reportError(error, { operation: "outreach.stage_two.generate", organisationId });
      return { error: "The follow-up draft could not be generated. Try again." };
    }
    try {
      const draft = parseReplyDraftJson(text);
      logApiHealth("gemini", "outreach.stage_two.generate", true, startedAt, { organisationId });
      return { draft, usage, prompt: { system: prompt.system, user: prompt.prompt } };
    } catch (parseError) {
      // A truncated sample is usually a one-off provider cut, so one retry is
      // worth it — but only while a second full call still fits the route
      // budget (see RETRY_BUDGET_MS). A slow first attempt fails as before.
      if (attempt === 1 && Date.now() - startedAt + TIMEOUT_MS <= RETRY_BUDGET_MS) {
        firstParseError = parseError;
        continue;
      }
      logApiHealth("gemini", "outreach.stage_two.generate", false, startedAt, { organisationId });
      await reportError(parseError, {
        operation: "outreach.stage_two.generate",
        organisationId,
        attempts: attempt,
        ...(attempt > 1 ? { firstParseError: String(firstParseError) } : {}),
      });
      return { error: "The follow-up draft could not be generated. Try again." };
    }
  }
  // Unreachable: both attempts return. Present so the compiler knows it.
  throw new Error("Stage two generation left its retry loop without a result.");
}
