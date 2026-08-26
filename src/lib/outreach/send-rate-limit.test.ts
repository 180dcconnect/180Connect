import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emailLimitMessage, resolveEmailSendLimit } from "./send-rate-limit.ts";

describe("email send limit", () => {
  it("is configurable and has safe positive defaults", () => {
    assert.deepEqual(resolveEmailSendLimit({ EMAIL_SEND_RATE_LIMIT: "12", EMAIL_SEND_RATE_WINDOW_SECONDS: "600" }), { maximum: 12, windowSeconds: 600 });
    assert.deepEqual(resolveEmailSendLimit({ EMAIL_SEND_RATE_LIMIT: "0" }), { maximum: 100, windowSeconds: 3600 });
  });
  it("gives a clear retry window", () => assert.match(emailLimitMessage(3600), /60 minutes/));
});
