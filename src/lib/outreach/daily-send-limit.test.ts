import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dailySendLimitMessage, dailySendWindowStart } from "./daily-send-limit.ts";

describe("dailySendWindowStart", () => {
  // UK is GMT in winter (= UTC), BST (UTC+1) in summer.

  it("returns midnight UK time in winter (GMT = UTC)", () => {
    // 2026-01-15 17:42 UTC — UK is on GMT, so UK midnight = 00:00 UTC
    assert.equal(
      dailySendWindowStart(new Date("2026-01-15T17:42:09.123Z")),
      "2026-01-15T00:00:00.000Z",
    );
  });

  it("returns midnight UK time in summer (BST = UTC+1)", () => {
    // 2026-08-25 17:42 UTC — UK is on BST (+1h), so UK midnight = 23:00 UTC the previous day
    assert.equal(
      dailySendWindowStart(new Date("2026-08-25T17:42:09.123Z")),
      "2026-08-24T23:00:00.000Z",
    );
  });

  it("does not roll over early for a time just before UK midnight in summer", () => {
    // 2026-08-25 22:59:59 UTC = 23:59:59 BST — still the same UK day as 23:00 UTC
    assert.equal(
      dailySendWindowStart(new Date("2026-08-25T22:59:59.999Z")),
      "2026-08-24T23:00:00.000Z",
    );
  });

  it("rolls over at UK midnight in summer", () => {
    // 2026-08-25 23:00:00 UTC = 00:00:00 BST on 2026-08-26
    assert.equal(
      dailySendWindowStart(new Date("2026-08-25T23:00:00.000Z")),
      "2026-08-25T23:00:00.000Z",
    );
  });

  it("does not roll over early for a time just before midnight UTC in winter", () => {
    // 2026-01-15 23:59:59 UTC — still same UK day
    assert.equal(
      dailySendWindowStart(new Date("2026-01-15T23:59:59.999Z")),
      "2026-01-15T00:00:00.000Z",
    );
  });
});

describe("dailySendLimitMessage", () => {
  it("gives a clear, actionable message", () => {
    assert.match(dailySendLimitMessage(), /daily outreach sending limit/i);
  });

  it("mentions midnight UK time", () => {
    assert.match(dailySendLimitMessage(), /midnight UK time/i);
  });
});
