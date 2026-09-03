import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dailySendLimitMessage, dailySendWindowStart } from "./daily-send-limit.ts";

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
