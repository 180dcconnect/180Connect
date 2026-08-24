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
export type CallStageOneModel = (input: {
  system: string;
  prompt: string;
}) => Promise<string>;

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

export function createStageOneModelCall(): CallStageOneModel {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) throw new Error("Gemini generation is not configured.");
  const google = createGoogleGenerativeAI({ apiKey });
  return async ({ system, prompt }) => {
    const result = await generateText({
      model: google(model),
      system,
      prompt,
      timeout: TIMEOUT_MS,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    return result.text;
  };
}

export async function generateStageOneDraft(
  organisationId: string,
  context: StageOneContext,
  callModel: CallStageOneModel,
  options: { length?: EmailLength; voice?: EmailVoice; tone?: EmailTone; opening?: OpeningApproach; closing?: ClosingApproach } = {},
): Promise<{ draft: StageOneDraft; sizeTemplate: SizeTemplate } | { error: string }> {
  const prompt = buildStageOnePrompt(context, options);
  const startedAt = Date.now();
  try {
    const draft = parseDraft(await callModel(prompt));
    logApiHealth("gemini", "outreach.stage_one.generate", true, startedAt, { organisationId });
    return { draft, sizeTemplate: prompt.sizeTemplate };
  } catch (error) {
    logApiHealth("gemini", "outreach.stage_one.generate", false, startedAt, { organisationId });
    await reportError(error, { operation: "outreach.stage_one.generate", organisationId });
    return { error: "The email draft could not be generated. Try again." };
  }
}
