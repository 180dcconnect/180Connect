import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStallNotificationPayload,
  findNewlyStalledClients,
  resolveStallNotificationRecipients,
  STALL_NOTIFICATION_TYPE,
} from "./stall-notifications.ts";
import type { StallFlag } from "./stall-detection.ts";

const ADMIN_1 = "11111111-1111-4111-8111-111111111111";
const ADMIN_2 = "22222222-2222-4222-8222-222222222222";
const CAM_OWNER = "33333333-3333-4333-8333-333333333333";
const CAM_OTHER = "44444444-4444-4444-8444-444444444444";

describe("buildStallNotificationPayload (F184 AC3)", () => {
  it("formats title, body, and links for a multi-day stall", () => {
    const payload = buildStallNotificationPayload(
      { id: "org-100", legal_name: "British Heart Foundation" },
      14,
    );

    assert.equal(payload.notificationType, STALL_NOTIFICATION_TYPE);
    assert.equal(payload.title, "British Heart Foundation is stalled");
    assert.equal(
      payload.body,
      "Inactive for 14 days with no open action. Follow-up is overdue.",
    );
    assert.equal(payload.linkPath, "/clients/org-100");
    assert.equal(payload.targetTable, "organisations");
    assert.equal(payload.targetId, "org-100");
  });

  it("handles singular day waiting formatting", () => {
    const payload = buildStallNotificationPayload(
      { id: "org-101", legal_name: "Shelter UK" },
      1,
    );

    assert.equal(
      payload.body,
      "Inactive for 1 day with no open action. Follow-up is overdue.",
    );
  });
});

describe("resolveStallNotificationRecipients (F184 AC2 / Recipient Rules)", () => {
  it("includes all active admins and the owning CAM", () => {
    const recipients = resolveStallNotificationRecipients(CAM_OWNER, [
      ADMIN_1,
      ADMIN_2,
    ]);

    assert.equal(recipients.length, 3);
    assert.ok(recipients.includes(ADMIN_1));
    assert.ok(recipients.includes(ADMIN_2));
    assert.ok(recipients.includes(CAM_OWNER));
  });

  it("excludes non-owning CAMs from alerts", () => {
    const recipients = resolveStallNotificationRecipients(CAM_OWNER, [
      ADMIN_1,
      ADMIN_2,
    ]);

    assert.ok(!recipients.includes(CAM_OTHER));
  });

  it("delivers only to admins when a client is unowned", () => {
    const recipientsNull = resolveStallNotificationRecipients(null, [
      ADMIN_1,
      ADMIN_2,
    ]);
    assert.deepEqual(recipientsNull.sort(), [ADMIN_1, ADMIN_2].sort());

    const recipientsEmpty = resolveStallNotificationRecipients("", [
      ADMIN_1,
      ADMIN_2,
    ]);
    assert.deepEqual(recipientsEmpty.sort(), [ADMIN_1, ADMIN_2].sort());
  });

  it("deduplicates when an admin is also the client owner", () => {
    const recipients = resolveStallNotificationRecipients(ADMIN_1, [
      ADMIN_1,
      ADMIN_2,
    ]);

    assert.equal(recipients.length, 2);
    assert.deepEqual(recipients.sort(), [ADMIN_1, ADMIN_2].sort());
  });

  it("handles empty admin list gracefully", () => {
    const recipients = resolveStallNotificationRecipients(CAM_OWNER, []);
    assert.deepEqual(recipients, [CAM_OWNER]);
  });
});

describe("findNewlyStalledClients (F184 Cadence / Option A)", () => {
  const flag1: StallFlag = { organisationId: "org-1", ownerId: CAM_OWNER, daysWaiting: 15 };
  const flag2: StallFlag = { organisationId: "org-2", ownerId: null, daysWaiting: 20 };
  const flag3: StallFlag = { organisationId: "org-3", ownerId: CAM_OTHER, daysWaiting: 14 };

  it("identifies clients newly stalled relative to previous sweep", () => {
    const previous = new Set(["org-1"]);
    const current = [flag1, flag2, flag3];

    const newlyStalled = findNewlyStalledClients(current, previous);

    assert.equal(newlyStalled.length, 2);
    assert.equal(newlyStalled[0].organisationId, "org-2");
    assert.equal(newlyStalled[1].organisationId, "org-3");
  });

  it("returns all flags when there was no previous sweep", () => {
    const previous = new Set<string>();
    const current = [flag1, flag2];

    const newlyStalled = findNewlyStalledClients(current, previous);

    assert.equal(newlyStalled.length, 2);
  });

  it("returns empty array when all stalled clients were already stalled", () => {
    const previous = new Set(["org-1", "org-2"]);
    const current = [flag1, flag2];

    const newlyStalled = findNewlyStalledClients(current, previous);

    assert.equal(newlyStalled.length, 0);
  });

  it("catches re-stalled clients previously cleared from the sweep", () => {
    // org-1 was previously stalled, cleared (not in previous set), and now stalled again
    const previous = new Set(["org-2"]);
    const current = [flag1, flag2];

    const newlyStalled = findNewlyStalledClients(current, previous);

    assert.equal(newlyStalled.length, 1);
    assert.equal(newlyStalled[0].organisationId, "org-1");
  });
});
