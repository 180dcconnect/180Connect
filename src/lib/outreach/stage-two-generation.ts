import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";
import type { StageOneUsage } from "./stage-one-generation.ts";
import type { ClosingApproach, EmailLength, EmailTone, EmailVoice } from "./stage-one-prompt.ts";
import { buildStageTwoPrompt, type StageTwoContext } from "./stage-two-prompt.ts";

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1536;

export type StageTwoDraft = { subject: string; body: string };
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

function parseDraft(text: string): StageTwoDraft {
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

export async function generateStageTwoDraft(
  organisationId: string,
  context: StageTwoContext,
  callModel: CallStageTwoModel,
  options: {
    length?: EmailLength;
    voice?: EmailVoice;
    tone?: EmailTone;
    closing?: ClosingApproach;
    newsEnabled?: boolean;
  } = {},
): Promise<{ draft: StageTwoDraft; usage: StageTwoUsage } | { error: string }> {
  const prompt = buildStageTwoPrompt(context, options);
  const startedAt = Date.now();
  try {
    const { text, usage } = await callModel(prompt);
    const draft = parseDraft(text);
    logApiHealth("gemini", "outreach.stage_two.generate", true, startedAt, { organisationId });
    return { draft, usage };
  } catch (error) {
    logApiHealth("gemini", "outreach.stage_two.generate", false, startedAt, { organisationId });
    await reportError(error, { operation: "outreach.stage_two.generate", organisationId });
    return { error: "The follow-up draft could not be generated. Try again." };
  }
}
