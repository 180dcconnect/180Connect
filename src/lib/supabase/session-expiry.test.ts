import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSessionExpired, INACTIVITY_TIMEOUT_MS } from "./session-expiry.ts";

describe("isSessionExpired", () => {
  it("is not expired when there is no recorded last activity", () => {
    const now = Date.now();
    assert.equal(isSessionExpired(null, now, INACTIVITY_TIMEOUT_MS), false);
  });

  it("is not expired when last activity is within the timeout window", () => {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    assert.equal(
      isSessionExpired(fiveMinutesAgo, now, INACTIVITY_TIMEOUT_MS),
      false,
    );
  });

  it("is expired when last activity is beyond the timeout window", () => {
    const now = Date.now();
    const fortyMinutesAgo = now - 40 * 60 * 1000;
    assert.equal(
      isSessionExpired(fortyMinutesAgo, now, INACTIVITY_TIMEOUT_MS),
      true,
    );
  });

  it("is expired exactly at the timeout boundary plus one millisecond", () => {
    const now = Date.now();
    const justOverTimeout = now - (INACTIVITY_TIMEOUT_MS + 1);
    assert.equal(isSessionExpired(justOverTimeout, now, INACTIVITY_TIMEOUT_MS), true);
  });

  it("respects a custom timeout value", () => {
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1000;
    // With a 5-minute timeout, 10 minutes idle should be expired
    assert.equal(isSessionExpired(tenMinutesAgo, now, 5 * 60 * 1000), true);
  });
});