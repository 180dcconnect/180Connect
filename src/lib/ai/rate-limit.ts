import { describeWait } from "../auth/login-throttle.ts";
import { logSecurityEvent } from "../log-security-event.ts";

export const DEFAULT_AI_GENERATION_LIMIT = 20;
export const DEFAULT_AI_GENERATION_WINDOW_SECONDS = 60 * 60;

/**
 * F214 — natural language search has its own allowance, in its own bucket (see
 * 20260925090000_add_rate_limit_bucket.sql). A generation is a deliberate,
 * expensive act a CAM performs a few times a day; a search is something they do
 * while working a list, so the two cannot sensibly share one hourly counter.
 *
 * 40 a day is generous against observed use and still a hard cost ceiling: at
 * roughly $0.0006 an interpretation, and only the interpretations that actually
 * reach the model (a repeat query is served from cache and a plain name search
 * never calls it), a full team of 25 hitting this limit every single day is
 * about $0.60. The limit exists to bound a runaway loop or a stuck client, not
 * to ration ordinary work.
 */
export const DEFAULT_AI_SEARCH_LIMIT = 40;
export const DEFAULT_AI_SEARCH_WINDOW_SECONDS = 24 * 60 * 60;

/** Bucket names, matching the column's documented vocabulary. */
export const GENERATION_BUCKET = "generation";
export const SEARCH_BUCKET = "search";

export type AiRateLimitConfig = {
  limit: number;
  windowSeconds: number;
};

export type AiRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAt: Date; retryAfterSeconds: number; message: string }
  | { allowed: false; unavailable: true; message: string };

export type AiRateLimitRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAiSearchRateLimitConfig(
  source: Record<string, string | undefined> = process.env,
): AiRateLimitConfig {
  return {
    limit: positiveInteger(source.AI_SEARCH_RATE_LIMIT, DEFAULT_AI_SEARCH_LIMIT),
    windowSeconds: positiveInteger(
      source.AI_SEARCH_RATE_WINDOW_SECONDS,
      DEFAULT_AI_SEARCH_WINDOW_SECONDS,
    ),
  };
}

export function getAiRateLimitConfig(
  source: Record<string, string | undefined> = process.env,
): AiRateLimitConfig {
  return {
    limit: positiveInteger(source.AI_GENERATION_RATE_LIMIT, DEFAULT_AI_GENERATION_LIMIT),
    windowSeconds: positiveInteger(
      source.AI_GENERATION_RATE_WINDOW_SECONDS,
      DEFAULT_AI_GENERATION_WINDOW_SECONDS,
    ),
  };
}

function blockedResult(retryAt: Date, now: Date, bucket: string): AiRateLimitResult {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((retryAt.getTime() - now.getTime()) / 1000),
  );
  return {
    allowed: false,
    retryAt,
    retryAfterSeconds,
    message: `You have reached the AI ${
      bucket === SEARCH_BUCKET ? "search" : "generation"
    } limit. Try again in ${describeWait(retryAt, now)}.`,
  };
}

/**
 * Atomically consumes one allowance from `bucket`. Storage failures fail closed:
 * unlike login, an unavailable throttle must not turn into an unlimited paid-API path.
 *
 * `bucket` defaults to the generation counter, so the four existing call sites
 * (booklet, Stage 1, Stage 1 stream, Stage 2) keep the exact behaviour F227 gave
 * them; F214's search passes SEARCH_BUCKET to get its own.
 */
export async function consumeAiGenerationAllowance(
  client: AiRateLimitRpcClient,
  userId: string,
  config: AiRateLimitConfig = getAiRateLimitConfig(),
  now: Date = new Date(),
  bucket: string = GENERATION_BUCKET,
): Promise<AiRateLimitResult> {
  try {
    const { data, error } = await client.rpc("consume_ai_generation_allowance", {
      p_user_id: userId,
      p_limit: config.limit,
      p_window_seconds: config.windowSeconds,
      p_bucket: bucket,
    });
    if (error) throw new Error(error.message);
    if (data === null) return { allowed: true };

    if (typeof data === "string") {
      const retryAt = new Date(data);
      if (!Number.isNaN(retryAt.getTime()) && retryAt > now) {
        logSecurityEvent("ai.generation_rate_limited", {
          userId,
          bucket,
          retryAfterSeconds: Math.ceil((retryAt.getTime() - now.getTime()) / 1000),
        });
        return blockedResult(retryAt, now, bucket);
      }
    }
    throw new Error("Rate-limit RPC returned an invalid response.");
  } catch (error) {
    logSecurityEvent("ai.generation_rate_limit_unavailable", {
      userId,
      bucket,
      cause: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      allowed: false,
      unavailable: true,
      message:
        bucket === SEARCH_BUCKET
          ? "Search interpretation is temporarily unavailable. Use the filters below."
          : "AI generation is temporarily unavailable. Try again shortly.",
    };
  }
}
