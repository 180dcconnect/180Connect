import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_EMAIL_NOTIFICATION_TYPES,
  EMAIL_NOTIFICATION_TYPE_OPTIONS,
  parseEmailNotificationTypes,
  wantsEmailNotification,
} from "./email-notification-preferences.ts";

describe("wantsEmailNotification (F179 AC1)", () => {
  it("wants email for a type present in the list", () => {
    assert.equal(wantsEmailNotification(["client_reply_received"], "client_reply_received"), true);
  });

  it("does not want email for a type absent from the list", () => {
    assert.equal(wantsEmailNotification(["client_reply_received"], "team_activity_digest"), false);
  });

  it("never emails F174's admin-fallback reply type", () => {
    assert.equal(wantsEmailNotification(["client_reply_received"], "unowned_client_reply_received"), false);
  });

  it("treats a null/undefined list as no email preferences at all", () => {
    assert.equal(wantsEmailNotification(null, "client_reply_received"), false);
    assert.equal(wantsEmailNotification(undefined, "client_reply_received"), false);
  });

  it("treats an empty list as opted out of everything", () => {
    assert.equal(wantsEmailNotification([], "client_reply_received"), false);
  });

  it("defaults to the owning-CAM reply type, matching the column default", () => {
    assert.deepEqual(DEFAULT_EMAIL_NOTIFICATION_TYPES, ["client_reply_received"]);
  });
});

describe("parseEmailNotificationTypes (F179 AC1)", () => {
  it("keeps only known types", () => {
    assert.deepEqual(
      parseEmailNotificationTypes(["client_reply_received", "made_up_type"]),
      ["client_reply_received"],
    );
  });

  it("drops non-string values from a tampered submission", () => {
    assert.deepEqual(parseEmailNotificationTypes([123, null, "client_reply_received", {}]), [
      "client_reply_received",
    ]);
  });

  it("deduplicates repeated values", () => {
    assert.deepEqual(
      parseEmailNotificationTypes(["client_reply_received", "client_reply_received"]),
      ["client_reply_received"],
    );
  });

  it("returns an empty array for an empty submission (opting out of everything)", () => {
    assert.deepEqual(parseEmailNotificationTypes([]), []);
  });

  it("every option in the catalogue survives its own round trip", () => {
    const types = EMAIL_NOTIFICATION_TYPE_OPTIONS.map((option) => option.type);
    assert.deepEqual(parseEmailNotificationTypes(types), types);
  });

  it("the default set survives its own round trip", () => {
    assert.deepEqual(parseEmailNotificationTypes(DEFAULT_EMAIL_NOTIFICATION_TYPES), [
      "client_reply_received",
    ]);
  });
});
