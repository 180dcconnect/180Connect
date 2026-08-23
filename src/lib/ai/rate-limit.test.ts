import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  consumeAiGenerationAllowance,
  getAiRateLimitConfig,
  type AiRateLimitRpcClient,
} from "./rate-limit.ts";

function clientWith(data: unknown, error: string | null = null): AiRateLimitRpcClient {
  return { rpc: async () => ({ data, error: error ? { message: error } : null }) };
}

describe("getAiRateLimitConfig", () => {
  it("reads configurable positive whole-number thresholds", () => {
    assert.deepEqual(
      getAiRateLimitConfig({
        AI_GENERATION_RATE_LIMIT: "7",
        AI_GENERATION_RATE_WINDOW_SECONDS: "900",
      }),
      { limit: 7, windowSeconds: 900 },
    );
  });

  it("uses safe defaults for missing or invalid values", () => {
    assert.deepEqual(getAiRateLimitConfig({ AI_GENERATION_RATE_LIMIT: "0" }), {
      limit: 20,
      windowSeconds: 3600,
    });
  });
});

describe("consumeAiGenerationAllowance", () => {
  it("allows a normal request and passes user-scoped configuration to the RPC", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client: AiRateLimitRpcClient = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: null, error: null };
      },
    };
    assert.deepEqual(
      await consumeAiGenerationAllowance(client, "user-1", { limit: 3, windowSeconds: 60 }),
      { allowed: true },
    );
    assert.deepEqual(calls, [{
      name: "consume_ai_generation_allowance",
      args: { p_user_id: "user-1", p_limit: 3, p_window_seconds: 60 },
    }]);
  });

  it("returns clear retry guidance for misuse", async () => {
    const now = new Date("2026-08-20T12:00:00Z");
    const result = await consumeAiGenerationAllowance(
      clientWith("2026-08-20T12:02:01Z"),
      "user-1",
      { limit: 3, windowSeconds: 300 },
      now,
    );
    assert.equal(result.allowed, false);
    assert.ok(!result.allowed && !("unavailable" in result));
    if (!result.allowed && !("unavailable" in result)) {
      assert.equal(result.retryAfterSeconds, 121);
      assert.equal(result.message, "You have reached the AI generation limit. Try again in 3 minutes.");
    }
  });

  it("fails closed and logs without exposing request content when storage fails", async () => {
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logs.push(args);
    try {
      const result = await consumeAiGenerationAllowance(
        clientWith(null, "permission denied"),
        "user-1",
      );
      assert.deepEqual(result, {
        allowed: false,
        unavailable: true,
        message: "AI generation is temporarily unavailable. Try again shortly.",
      });
    } finally {
      console.error = original;
    }
    assert.equal(logs.length, 1);
    assert.match(String(logs[0]?.[0]), /ai\.generation_rate_limit_unavailable/);
    assert.doesNotMatch(JSON.stringify(logs), /prompt|booklet|email/i);
  });
});
