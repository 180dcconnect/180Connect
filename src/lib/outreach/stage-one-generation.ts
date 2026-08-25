import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";
import {
  buildStageOnePrompt,
  type EmailLength,
  type EmailVoice,
  type EmailTone,
  type OpeningApproach,
  type ClosingApproach,
  type SizeTemplate,
  type StageOneContext,
} from "./stage-one-prompt.ts";

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1536;

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
      maxOutputTokens: MAX_OUTPUT_TOKENS,
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

export async function generateStageOneDraft(
  organisationId: string,
  context: StageOneContext,
  callModel: CallStageOneModel,
  options: { length?: EmailLength; voice?: EmailVoice; tone?: EmailTone; opening?: OpeningApproach; closing?: ClosingApproach } = {},
): Promise<{ draft: StageOneDraft; sizeTemplate: SizeTemplate; usage: StageOneUsage } | { error: string }> {
  const prompt = buildStageOnePrompt(context, options);
  const startedAt = Date.now();
  try {
    const { text, usage } = await callModel(prompt);
    const draft = parseDraft(text);
    logApiHealth("gemini", "outreach.stage_one.generate", true, startedAt, { organisationId });
    return { draft, sizeTemplate: prompt.sizeTemplate, usage };
  } catch (error) {
    logApiHealth("gemini", "outreach.stage_one.generate", false, startedAt, { organisationId });
    await reportError(error, { operation: "outreach.stage_one.generate", organisationId });
    return { error: "The email draft could not be generated. Try again." };
  }
}
