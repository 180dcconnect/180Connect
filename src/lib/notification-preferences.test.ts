import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isNotificationFrequency,
  shouldDeliverImmediately,
} from "./notification-preferences.ts";

describe("isNotificationFrequency", () => {
  it("accepts every valid frequency", () => {
    assert.equal(isNotificationFrequency("immediate"), true);
    assert.equal(isNotificationFrequency("daily"), true);
    assert.equal(isNotificationFrequency("weekly"), true);
  });

  it("rejects an unknown or malformed value", () => {
    assert.equal(isNotificationFrequency("hourly"), false);
    assert.equal(isNotificationFrequency(""), false);
    assert.equal(isNotificationFrequency(null), false);
    assert.equal(isNotificationFrequency(undefined), false);
    assert.equal(isNotificationFrequency(42), false);
  });
});

describe("shouldDeliverImmediately (F178 AC2/AC3)", () => {
  it("always delivers immediately for an immediate preference", () => {
    assert.equal(shouldDeliverImmediately("immediate", "team_activity_digest"), true);
  });

  it("defers a daily preference for an ordinary notification type", () => {
    assert.equal(shouldDeliverImmediately("daily", "team_activity_digest"), false);
  });

  it("defers a weekly preference for an ordinary notification type", () => {
    assert.equal(shouldDeliverImmediately("weekly", "outreach_send_failed"), false);
  });

  it("overrides a daily/weekly preference for an always-immediate type (AC3's reply example)", () => {
    assert.equal(shouldDeliverImmediately("daily", "reply_received"), true);
    assert.equal(shouldDeliverImmediately("weekly", "reply_received"), true);
  });
});
