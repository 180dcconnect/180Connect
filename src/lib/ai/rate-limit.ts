import { describeWait } from "../auth/login-throttle.ts";
import { logSecurityEvent } from "../log-security-event.ts";

export const DEFAULT_AI_GENERATION_LIMIT = 20;
export const DEFAULT_AI_GENERATION_WINDOW_SECONDS = 60 * 60;

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

function blockedResult(retryAt: Date, now: Date): AiRateLimitResult {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((retryAt.getTime() - now.getTime()) / 1000),
  );
  return {
    allowed: false,
    retryAt,
    retryAfterSeconds,
    message: `You have reached the AI generation limit. Try again in ${describeWait(retryAt, now)}.`,
  };
}

/**
 * Atomically consumes one generation allowance. Storage failures fail closed:
 * unlike login, an unavailable throttle must not turn into an unlimited paid-API path.
 */
export async function consumeAiGenerationAllowance(
  client: AiRateLimitRpcClient,
  userId: string,
  config: AiRateLimitConfig = getAiRateLimitConfig(),
  now: Date = new Date(),
): Promise<AiRateLimitResult> {
  try {
    const { data, error } = await client.rpc("consume_ai_generation_allowance", {
      p_user_id: userId,
      p_limit: config.limit,
      p_window_seconds: config.windowSeconds,
    });
    if (error) throw new Error(error.message);
    if (data === null) return { allowed: true };

    if (typeof data === "string") {
      const retryAt = new Date(data);
      if (!Number.isNaN(retryAt.getTime()) && retryAt > now) {
        logSecurityEvent("ai.generation_rate_limited", {
          userId,
          retryAfterSeconds: Math.ceil((retryAt.getTime() - now.getTime()) / 1000),
        });
        return blockedResult(retryAt, now);
      }
    }
    throw new Error("Rate-limit RPC returned an invalid response.");
  } catch (error) {
    logSecurityEvent("ai.generation_rate_limit_unavailable", {
      userId,
      cause: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      allowed: false,
      unavailable: true,
      message: "AI generation is temporarily unavailable. Try again shortly.",
    };
  }
}
