import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";
import {
  buildStageOnePrompt,
  type EmailLength,
  type EmailRegister,
  type OpeningApproach,
  type ClosingApproach,
  type SizeTemplate,
  type StageOneContext,
} from "./stage-one-prompt.ts";

/**
 * Model-call ceiling. Free-tier Gemini regularly takes 30–45s on this prompt
 * (the saved booklet rides along as context), so the old 30s abort fired on
 * healthy generations. 55s leaves ~5s of the route's 60s maxDuration for the
 * reads and writes around the call — tight on purpose: anything slower should
 * fail loudly rather than die silently at the platform edge.
 */
const TIMEOUT_MS = 55_000;

/**
 * Shared model options for both stage-one call shapes (one-shot and stream).
 *
 * `thinkingLevel: "minimal"` is the load-bearing half. Gemini 3 Flash thinks
 * by default, and thinking tokens count against `maxOutputTokens` — with the
 * old 1536-token ceiling the model spent ~1400 tokens thinking through the
 * booklet context and had ~70 tokens left for the email, so every generation
 * for a context-rich client cut off mid-word at the same ~270 characters
 * (`Unterminated string`, three calls running). A templated outreach draft
 * off a fully-specified prompt needs no deliberation, so minimal thinking
 * buys back both the truncated output and most of the 30–50s latency.
 *
 * 4096 output tokens is headroom, not a target: a detailed draft is ~350.
 */
export const STAGE_ONE_MODEL_OPTIONS = {
  maxOutputTokens: 4096,
  providerOptions: {
    google: { thinkingConfig: { thinkingLevel: "minimal" } },
  },
} as const;

export type StageOneDraft = { subject: string; body: string };
// F213 — LLM Cost Tracking: token counts travel back with the raw text rather
// than being re-derived later — the AI SDK's own usage figures are the only
// authoritative source, and are only available on the response itself.
// `| undefined` (not defaulted to null here) mirrors the AI SDK's own
// LanguageModelUsage type exactly; generateStageOneDraft is what decides how an
// absent count should be stored.
export type StageOneUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
};
export type CallStageOneModel = (input: {
  system: string;
  prompt: string;
}) => Promise<{ text: string; usage: StageOneUsage }>;

function parseDraft(text: string): StageOneDraft {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object") throw new Error("Gemini returned invalid draft JSON.");
  const { subject, body } = parsed as Record<string, unknown>;
  if (typeof subject !== "string" || !subject.trim() || typeof body !== "string" || !body.trim()) {
    throw new Error("Gemini returned an incomplete email draft.");
  }
  return { subject: subject.trim(), body: body.trim() };
}

// F113 — Track Model Used: `model` travels back out alongside the callable itself,
// read once here from the same env var the call already depends on, rather than a
// second, separate read at the insert site that could in principle drift from
// whichever model the call actually used.
export function createStageOneModelCall(): { callModel: CallStageOneModel; model: string } {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) throw new Error("Gemini generation is not configured.");
  const google = createGoogleGenerativeAI({ apiKey });
  const callModel: CallStageOneModel = async ({ system, prompt }) => {
    const result = await generateText({
      model: google(model),
      system,
      prompt,
      timeout: TIMEOUT_MS,
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

// F112 — Save AI Prompt and Output: the exact prompt sent travels back out
// alongside the draft, the same way F113's `model` does — read once here, at the
// point it's actually used, rather than re-built at the insert site where it could
// in principle drift from what was really sent.
export type StageOnePromptSent = { system: string; user: string };

export async function generateStageOneDraft(
  organisationId: string,
  context: StageOneContext,
  callModel: CallStageOneModel,
  options: { length?: EmailLength; register?: EmailRegister; opening?: OpeningApproach; closing?: ClosingApproach } = {},
): Promise<
  | { draft: StageOneDraft; sizeTemplate: SizeTemplate; usage: StageOneUsage; prompt: StageOnePromptSent }
  | { error: string }
> {
  const prompt = buildStageOnePrompt(context, options);
  const startedAt = Date.now();
  try {
    const { text, usage } = await callModel(prompt);
    const draft = parseDraft(text);
    logApiHealth("gemini", "outreach.stage_one.generate", true, startedAt, { organisationId });
    return { draft, sizeTemplate: prompt.sizeTemplate, usage, prompt: { system: prompt.system, user: prompt.prompt } };
  } catch (error) {
    logApiHealth("gemini", "outreach.stage_one.generate", false, startedAt, { organisationId });
    await reportError(error, { operation: "outreach.stage_one.generate", organisationId });
    return { error: "The email draft could not be generated. Try again." };
  }
}
