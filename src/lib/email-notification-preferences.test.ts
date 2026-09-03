import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMAIL_NOTIFICATION_TYPE_OPTIONS,
  parseEmailNotificationTypes,
  wantsEmailNotification,
} from "./email-notification-preferences.ts";

describe("wantsEmailNotification (F179 AC1)", () => {
  it("wants email for a type present in the list", () => {
    assert.equal(wantsEmailNotification(["reply_received"], "reply_received"), true);
  });

  it("does not want email for a type absent from the list", () => {
    assert.equal(wantsEmailNotification(["reply_received"], "team_activity_digest"), false);
  });

  it("treats a null/undefined list as no email preferences at all", () => {
    assert.equal(wantsEmailNotification(null, "reply_received"), false);
    assert.equal(wantsEmailNotification(undefined, "reply_received"), false);
  });

  it("treats an empty list as opted out of everything", () => {
    assert.equal(wantsEmailNotification([], "reply_received"), false);
  });
});

describe("parseEmailNotificationTypes (F179 AC1)", () => {
  it("keeps only known types", () => {
    assert.deepEqual(
      parseEmailNotificationTypes(["reply_received", "made_up_type"]),
      ["reply_received"],
    );
  });

  it("drops non-string values from a tampered submission", () => {
    assert.deepEqual(parseEmailNotificationTypes([123, null, "reply_received", {}]), [
      "reply_received",
    ]);
  });

  it("deduplicates repeated values", () => {
    assert.deepEqual(
      parseEmailNotificationTypes(["reply_received", "reply_received"]),
      ["reply_received"],
    );
  });

  it("returns an empty array for an empty submission (opting out of everything)", () => {
    assert.deepEqual(parseEmailNotificationTypes([]), []);
  });

  it("every option in the catalogue survives its own round trip", () => {
    const types = EMAIL_NOTIFICATION_TYPE_OPTIONS.map((option) => option.type);
    assert.deepEqual(parseEmailNotificationTypes(types), types);
  });
});
