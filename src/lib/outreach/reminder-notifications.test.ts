import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reminderNotificationBody,
  reminderNotificationTitle,
  selectNewReminders,
  type PriorReminderNotification,
  type ReminderRecommendation,
} from "./reminder-notifications.ts";

function rec(overrides: Partial<ReminderRecommendation> = {}): ReminderRecommendation {
  return {
    organisationId: "org-1",
    legalName: "1-1 Coco",
    statusLabel: "Initial outreach sent",
    lastActivityAt: "2026-08-20T09:00:00Z",
    daysWaiting: 8,
    urgency: "due",
    ownerId: "cam-1",
    ...overrides,
  };
}

describe("selectNewReminders (F175 AC3)", () => {
  it("selects a recommendation with no prior notification", () => {
    const result = selectNewReminders([rec()], []);
    assert.equal(result.length, 1);
  });

  it("skips a recommendation already notified for the same activity clock", () => {
    const prior: PriorReminderNotification[] = [
      { organisationId: "org-1", lastActivityAt: "2026-08-20T09:00:00Z" },
    ];
    assert.deepEqual(selectNewReminders([rec()], prior), []);
  });

  it("re-selects once the client's activity clock has moved on (CAM followed up, or client replied)", () => {
    const prior: PriorReminderNotification[] = [
      { organisationId: "org-1", lastActivityAt: "2026-08-01T09:00:00Z" },
    ];
    // A later sweep recomputed lastActivityAt because something happened
    // (a follow-up was sent) and the client has since gone quiet again.
    const result = selectNewReminders([rec({ lastActivityAt: "2026-08-20T09:00:00Z" })], prior);
    assert.equal(result.length, 1);
  });

  it("does not confuse two different clients' prior notifications", () => {
    const prior: PriorReminderNotification[] = [
      { organisationId: "org-2", lastActivityAt: "2026-08-20T09:00:00Z" },
    ];
    const result = selectNewReminders([rec({ organisationId: "org-1" })], prior);
    assert.equal(result.length, 1);
  });

  it("handles an empty recommendation list", () => {
    assert.deepEqual(selectNewReminders([], []), []);
  });

  it("evaluates each of several clients independently", () => {
    const prior: PriorReminderNotification[] = [
      { organisationId: "already-notified", lastActivityAt: "2026-08-20T09:00:00Z" },
    ];
    const recommendations = [
      rec({ organisationId: "already-notified", lastActivityAt: "2026-08-20T09:00:00Z" }),
      rec({ organisationId: "never-notified", lastActivityAt: "2026-08-20T09:00:00Z" }),
    ];
    const result = selectNewReminders(recommendations, prior);
    assert.deepEqual(
      result.map((r) => r.organisationId),
      ["never-notified"],
    );
  });
});

describe("reminderNotificationTitle (F175 AC2)", () => {
  it("names the client so the title alone identifies who it's about", () => {
    assert.equal(reminderNotificationTitle("1-1 Coco"), "Follow up with 1-1 Coco");
  });
});

describe("reminderNotificationBody", () => {
  it("pluralises days correctly", () => {
    assert.equal(reminderNotificationBody({ daysWaiting: 1, urgency: "due" }), "1 day without a reply.");
    assert.equal(reminderNotificationBody({ daysWaiting: 8, urgency: "due" }), "8 days without a reply.");
  });

  it("flags urgency in the body when the second threshold has been crossed", () => {
    assert.equal(
      reminderNotificationBody({ daysWaiting: 15, urgency: "urgent" }),
      "15 days without a reply. This is now urgent.",
    );
  });
});
