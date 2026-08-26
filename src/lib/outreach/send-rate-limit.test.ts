import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emailLimitMessage, emailSendWindowStart, isNearSendLimit, resolveEmailSendLimit } from "./send-rate-limit.ts";

describe("email send limit", () => {
  it("is configurable and has safe positive defaults", () => {
    assert.deepEqual(resolveEmailSendLimit({ EMAIL_SEND_RATE_LIMIT: "12", EMAIL_SEND_RATE_WINDOW_SECONDS: "600" }), { maximum: 12, windowSeconds: 600 });
    assert.deepEqual(resolveEmailSendLimit({ EMAIL_SEND_RATE_LIMIT: "0" }), { maximum: 100, windowSeconds: 3600 });
  });
  it("gives a clear retry window", () => assert.match(emailLimitMessage(3600), /60 minutes/));
});

describe("emailSendWindowStart (F228)", () => {
  it("returns an ISO timestamp exactly one window before now", () => {
    const now = Date.parse("2026-09-01T10:00:00.000Z");
    assert.equal(emailSendWindowStart(3600, now), "2026-09-01T09:00:00.000Z");
    assert.equal(emailSendWindowStart(600, now), "2026-09-01T09:50:00.000Z");
  });
});

describe("isNearSendLimit — the F228 warn-before-block boundary (F227 scope)", () => {
  it("warns from 80% of a round limit", () => {
    assert.equal(isNearSendLimit(79, 100), false);
    assert.equal(isNearSendLimit(80, 100), true);
    assert.equal(isNearSendLimit(99, 100), true);
  });

  it("rounds the threshold up so small limits still get a warning step", () => {
    // ceil(7 * 0.8) = ceil(5.6) = 6
    assert.equal(isNearSendLimit(5, 7), false);
    assert.equal(isNearSendLimit(6, 7), true);
    assert.equal(isNearSendLimit(7, 7), true);
    // ceil(1 * 0.8) = 1 — even limit 1 warns from the first send
    assert.equal(isNearSendLimit(1, 1), true);
  });

  it("never warns below zero usage", () => {
    assert.equal(isNearSendLimit(0, 100), false);
  });
});
