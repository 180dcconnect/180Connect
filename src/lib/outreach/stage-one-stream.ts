import { streamObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";
import {
  buildStageOnePrompt,
  type ClosingApproach,
  type EmailLength,
  type EmailRegister,
  type OpeningApproach,
  type SizeTemplate,
  type StageOneContext,
} from "./stage-one-prompt.ts";
import {
  createStageOneModelCall,
  generateStageOneDraft,
  STAGE_ONE_MODEL_OPTIONS,
  type CallStageOneModel,
  type StageOneUsage,
} from "./stage-one-generation.ts";

/**
 * Token-streaming twin of `generateStageOneDraft` (stage-one-generation.ts).
 *
 * That function waits for the whole draft and hands back one JSON object —
 * fine for a server-to-server call, but a 30–50s silence in the browser reads
 * as a stall (and free-tier Gemini genuinely takes that long on this prompt).
 * This streams the draft's tokens as they arrive so the UI can show a live
 * thinking state and render the email as it is written.
 *
 * Honesty note on "thinking": the free-tier model behind `GEMINI_MODEL`
 * exposes no reasoning trace through this SDK — there is no thought stream to
 * show. The milestones below are the real pipeline stages the server actually
 * passes through (request sent → first token → body flowing → saving), not a
 * narration of the model's internals.
 */

const TIMEOUT_MS = 55_000;

/** The envelope is unchanged from the one-shot path: subject plus body. */
export const stageOneDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export type StageOnePartial = { subject?: string; body?: string };

export type StageOneStreamEvent =
  | { type: "stage"; stage: "reading" | "drafting" | "saving" }
  | { type: "subject"; subject: string }
  | { type: "delta"; text: string }
  /** The token stream proved unparseable mid-flight: the client must discard
      accumulated text — a one-shot regeneration follows, and appending its
      body to the failed stream's prefix would weld two drafts together. */
  | { type: "restart" };

/**
 * Injectable model seam, mirroring `CallStageOneModel` in the one-shot path:
 * partial drafts as they arrive, plus the validated final draft and usage.
 * Tests feed a fake async iterable; production wraps `streamObject`.
 */
export type StreamStageOneModel = (input: {
  system: string;
  prompt: string;
}) => {
  partials: AsyncIterable<StageOnePartial>;
  final: Promise<{ draft: { subject: string; body: string }; usage: StageOneUsage }>;
};

export function createStageOneStreamCall(): {
  streamModel: StreamStageOneModel;
  callModel: CallStageOneModel;
  model: string;
} {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) throw new Error("Gemini generation is not configured.");
  const google = createGoogleGenerativeAI({ apiKey });
  const streamModel: StreamStageOneModel = ({ system, prompt }) => {
    // `streamObject` takes no `timeout` option (unlike `generateText`), so
    // the same ceiling arrives as an abort signal instead. Token budget and
    // thinking level are shared with the one-shot path (STAGE_ONE_MODEL_OPTIONS)
    // so the two can never disagree about how much room a draft gets.
    const result = streamObject({
      model: google(model),
      schema: stageOneDraftSchema,
      system,
      prompt,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      ...STAGE_ONE_MODEL_OPTIONS,
    });
    return {
      partials: result.partialObjectStream,
      final: Promise.all([result.object, result.usage]).then(([draft, usage]) => ({
        draft,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        },
      })),
    };
  };
  // The one-shot twin of the stream above, for the fallback below. Built by
  // the one-shot path's own factory so both read the same env the same way.
  const { callModel } = createStageOneModelCall();
  return { streamModel, callModel, model };
}

export type StageOneStreamOptions = {
  length?: EmailLength;
  register?: EmailRegister;
  opening?: OpeningApproach;
  closing?: ClosingApproach;
};

/**
 * The model sometimes opens the body by restating the subject ("Subject:
 * Working together", or the bare line) even though the envelope carries it
 * separately. Left in, the subject flashes at the top of the streaming text
 * and then again in its own line — so the first body line goes when it
 * matches the subject, case- and punctuation-insensitively. Anything else is
 * untouched: a body that merely starts similarly keeps its line.
 */
export function stripSubjectEcho(subject: string, body: string): string {
  const lines = body.split("\n");
  const first = lines[0]?.trim() ?? "";
  const clean = (text: string) =>
    text
      .toLowerCase()
      .replace(/^(subject|re)\s*:\s*/, "")
      .replace(/[.。!?…]+$/, "")
      .trim();
  if (first && clean(first) === clean(subject)) {
    return lines.slice(1).join("\n").trimStart();
  }
  return body;
}

/**
 * Streams one draft, forwarding live events. Resolves with the validated
 * final draft (schema-checked by `streamObject`, so no JSON repair), the size
 * template, usage and the exact prompt sent — or `{ error }`, the same
 * retryable copy the one-shot path returns.
 *
 * If the token stream proves unparseable (free-tier Gemini intermittently
 * returns fenced or prosaic output that strict structured output rejects —
 * the failure the one-shot path never sees, because it strips fences by
 * hand), it falls back to a one-shot regeneration when `fallbackModel` is
 * provided: clients see `restart`, then the full draft arriving at once. A
 * slow draft beats no draft; the fallback costs one extra model call.
 */
export async function streamStageOneDraft(
  organisationId: string,
  context: StageOneContext,
  streamModel: StreamStageOneModel,
  onEvent: (event: StageOneStreamEvent) => void,
  options: StageOneStreamOptions = {},
  fallbackModel?: CallStageOneModel,
): Promise<
  | {
      draft: { subject: string; body: string };
      sizeTemplate: SizeTemplate;
      usage: StageOneUsage;
      prompt: { system: string; user: string };
    }
  | { error: string }
> {
  const prompt = buildStageOnePrompt(context, options);
  const startedAt = Date.now();
  try {
    onEvent({ type: "stage", stage: "reading" });
    const { partials, final } = streamModel({ system: prompt.system, prompt: prompt.prompt });
    let firstToken = true;
    let sentBodyLength = 0;
    for await (const partial of partials) {
      if (firstToken) {
        firstToken = false;
        onEvent({ type: "stage", stage: "drafting" });
      }
      // Subject arrives before the body and is short: hold it until it is
      // complete rather than jittering a half-written line on screen. The
      // body is long, so it goes out as incremental tails.
      const body = partial.body ?? "";
      if (body.length > sentBodyLength) {
        onEvent({ type: "delta", text: body.slice(sentBodyLength) });
        sentBodyLength = body.length;
      }
    }
    const { draft, usage } = await final;
    if (!draft.subject.trim() || !draft.body.trim()) {
      throw new Error("Gemini returned an incomplete email draft.");
    }
    onEvent({ type: "subject", subject: draft.subject.trim() });
    onEvent({ type: "stage", stage: "saving" });
    logApiHealth("gemini", "outreach.stage_one.generate", true, startedAt, { organisationId });
    return {
      draft: { subject: draft.subject.trim(), body: stripSubjectEcho(draft.subject, draft.body.trim()) },
      sizeTemplate: prompt.sizeTemplate,
      usage,
      prompt: { system: prompt.system, user: prompt.prompt },
    };
  } catch (error) {
    if (fallbackModel) {
      return await fallbackOneShot(organisationId, context, fallbackModel, onEvent, options, error);
    }
    logApiHealth("gemini", "outreach.stage_one.generate", false, startedAt, { organisationId });
    await reportError(error, { operation: "outreach.stage_one.generate", organisationId });
    return { error: "The email draft could not be generated. Try again." };
  }
}

/**
 * The stream failed; regenerate one-shot and hand back the same shape. The
 * one-shot parser strips markdown fences by hand, which is exactly what
 * strict structured output chokes on — so this succeeds wherever the old
 * endpoint did.
 *
 * Up to two one-shot attempts: free-tier responses intermittently truncate
 * mid-string (a clean `Unterminated string` cut, far under the token ceiling),
 * and a truncated generation is worth one more try before telling the CAM to
 * retry by hand.
 */
async function fallbackOneShot(
  organisationId: string,
  context: StageOneContext,
  fallbackModel: CallStageOneModel,
  onEvent: (event: StageOneStreamEvent) => void,
  options: StageOneStreamOptions,
  streamError: unknown,
): Promise<
  | {
      draft: { subject: string; body: string };
      sizeTemplate: SizeTemplate;
      usage: StageOneUsage;
      prompt: { system: string; user: string };
    }
  | { error: string }
> {
  await reportError(streamError, {
    operation: "outreach.stage_one.stream_unparseable",
    organisationId,
  });
  onEvent({ type: "restart" });
  onEvent({ type: "stage", stage: "drafting" });
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateStageOneDraft(organisationId, context, fallbackModel, options);
    // Health logging stays inside generateStageOneDraft (it logs its own
    // success/failure) — logging here too would double-count one generation.
    if (!("error" in result)) {
      const draft = {
        subject: result.draft.subject,
        body: stripSubjectEcho(result.draft.subject, result.draft.body),
      };
      onEvent({ type: "subject", subject: draft.subject });
      onEvent({ type: "delta", text: draft.body });
      onEvent({ type: "stage", stage: "saving" });
      return { ...result, draft };
    }
    if (attempt < MAX_ATTEMPTS) {
      await reportError(new Error(`Fallback one-shot attempt ${attempt} failed; retrying.`), {
        operation: "outreach.stage_one.fallback_retry",
        organisationId,
        attempt,
      });
    } else {
      return result;
    }
  }
  return { error: "The email draft could not be generated. Try again." };
}
