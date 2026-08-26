import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_OUTREACH_DAILY_SEND_LIMIT,
  dailySendLimitMessage,
  dailySendWindowStart,
  resolveOutreachDailyLimit,
} from "./daily-send-limit.ts";

describe("resolveOutreachDailyLimit", () => {
  it("returns the configured limit", async () => {
    assert.equal(await resolveOutreachDailyLimit(async () => 42), 42);
  });

  it("falls back to the default when no configuration row exists", async () => {
    assert.equal(await resolveOutreachDailyLimit(async () => null), DEFAULT_OUTREACH_DAILY_SEND_LIMIT);
  });

  it("falls back to the default, and logs, when the read throws", async () => {
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logs.push(args);
    try {
      assert.equal(
        await resolveOutreachDailyLimit(async () => {
          throw new Error("permission denied");
        }),
        DEFAULT_OUTREACH_DAILY_SEND_LIMIT,
      );
    } finally {
      console.error = original;
    }
    assert.equal(logs.length, 1);
    assert.match(String(logs[0]?.[0]), /outreach\.daily_send_limit_unavailable/);
  });
});

describe("dailySendWindowStart", () => {
  it("returns the start of the UTC calendar day", () => {
    assert.equal(
      dailySendWindowStart(new Date("2026-08-25T17:42:09.123Z")),
      "2026-08-25T00:00:00.000Z",
    );
  });

  it("does not roll over early for a time just before midnight UTC", () => {
    assert.equal(
      dailySendWindowStart(new Date("2026-08-25T23:59:59.999Z")),
      "2026-08-25T00:00:00.000Z",
    );
  });
});

describe("dailySendLimitMessage", () => {
  it("gives a clear, actionable message", () => {
    assert.match(dailySendLimitMessage(), /daily outreach sending limit/i);
  });
});
