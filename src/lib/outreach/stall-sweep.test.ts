import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sweepStalledClients, type StallSweepDeps } from "./stall-sweep.ts";
import type { ClientActivity } from "./follow-up-recommendations.ts";

const NOW = new Date("2026-09-15T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const ADMIN_1 = "11111111-1111-4111-8111-111111111111";
const ADMIN_2 = "22222222-2222-4222-8222-222222222222";
const CAM_A = "33333333-3333-4333-8333-333333333333";
const CAM_B = "44444444-4444-4444-8444-444444444444";

function createMockDeps(overrides: Partial<StallSweepDeps> = {}): {
  deps: StallSweepDeps;
  recordedSweeps: { stalled: string[]; newly: string[]; sent: number }[];
  deliveredNotifications: {
    recipient: string;
    orgId: string;
    title: string;
    body: string;
  }[];
} {
  const recordedSweeps: { stalled: string[]; newly: string[]; sent: number }[] = [];
  const deliveredNotifications: {
    recipient: string;
    orgId: string;
    title: string;
    body: string;
  }[] = [];

  const defaultDeps: StallSweepDeps = {
    async loadOrganisations() {
      return [
        {
          id: "org-1",
          legal_name: "Alpha Foundation",
          outreach_status: "follow_up_sent",
          owner_id: CAM_A,
        },
        {
          id: "org-2",
          legal_name: "Beta Trust",
          outreach_status: "initial_outreach_sent",
          owner_id: null,
        },
        {
          id: "org-3",
          legal_name: "Gamma Society",
          outreach_status: "no_response",
          owner_id: CAM_B,
        },
      ];
    },

    async loadPreferences() {
      return [
        {
          user_id: CAM_A,
          first_follow_up_days: 7,
          second_follow_up_days: 14,
        },
        {
          user_id: CAM_B,
          first_follow_up_days: 7,
          second_follow_up_days: 14,
        },
      ];
    },

    async loadActivities() {
      return new Map<string, ClientActivity>([
        // org-1: silent for 20 days (> 14d urgent threshold) -> stalled
        ["org-1", { lastEmailSentAt: daysAgo(20), lastReplyReceivedAt: null, lastStatusChangeAt: null }],
        // org-2: silent for 16 days (> default 14d threshold, unowned) -> stalled
        ["org-2", { lastEmailSentAt: daysAgo(16), lastReplyReceivedAt: null, lastStatusChangeAt: null }],
        // org-3: silent for 5 days (< 14d) -> not stalled
        ["org-3", { lastEmailSentAt: daysAgo(5), lastReplyReceivedAt: null, lastStatusChangeAt: null }],
      ]);
    },

    async loadOpenActionOrgIds() {
      return new Set<string>();
    },

    async loadActiveAdminUserIds() {
      return [ADMIN_1, ADMIN_2];
    },

    async loadLatestRecordedStallIds() {
      return [];
    },

    async recordStallSweep(stalled, newly, sent) {
      recordedSweeps.push({ stalled, newly, sent });
    },

    async notifyStalled({ recipientUserId, organisationId, payload }) {
      deliveredNotifications.push({
        recipient: recipientUserId,
        orgId: organisationId,
        title: payload.title,
        body: payload.body,
      });
      return true;
    },
  };

  return {
    deps: { ...defaultDeps, ...overrides },
    recordedSweeps,
    deliveredNotifications,
  };
}

describe("sweepStalledClients (F184 Whole-Team Stall Notification)", () => {
  it("dispatches notifications to admins + owning CAM for newly stalled clients", async () => {
    const { deps, recordedSweeps, deliveredNotifications } = createMockDeps();

    const result = await sweepStalledClients(deps, NOW);

    assert.equal(result.totalClients, 3);
    assert.equal(result.stalledCount, 2); // org-1 and org-2
    assert.equal(result.newlyStalledCount, 2);
    assert.equal(result.changed, true);

    // org-1 (owned by CAM_A): recipients should be ADMIN_1, ADMIN_2, CAM_A
    const org1Notifications = deliveredNotifications.filter((n) => n.orgId === "org-1");
    assert.equal(org1Notifications.length, 3);
    const org1Recipients = org1Notifications.map((n) => n.recipient).sort();
    assert.deepEqual(org1Recipients, [ADMIN_1, ADMIN_2, CAM_A].sort());
    assert.equal(org1Notifications[0].title, "Alpha Foundation is stalled");
    assert.ok(org1Notifications[0].body.includes("Inactive for 20 days"));

    // org-2 (unowned): recipients should be ADMIN_1, ADMIN_2 only
    const org2Notifications = deliveredNotifications.filter((n) => n.orgId === "org-2");
    assert.equal(org2Notifications.length, 2);
    const org2Recipients = org2Notifications.map((n) => n.recipient).sort();
    assert.deepEqual(org2Recipients, [ADMIN_1, ADMIN_2].sort());

    // CAM_B does NOT own org-1 or org-2, and must NOT receive any notification
    const camBNotifications = deliveredNotifications.filter((n) => n.recipient === CAM_B);
    assert.equal(camBNotifications.length, 0);

    // Audit log record
    assert.equal(recordedSweeps.length, 1);
    assert.deepEqual(recordedSweeps[0].stalled, ["org-1", "org-2"]);
    assert.deepEqual(recordedSweeps[0].newly, ["org-1", "org-2"]);
    assert.equal(recordedSweeps[0].sent, 5); // 3 for org-1 + 2 for org-2
  });

  it("does not re-notify for clients that were already stalled in previous sweep (Option A)", async () => {
    // Both org-1 and org-2 were already stalled in previous sweep
    const { deps, recordedSweeps, deliveredNotifications } = createMockDeps({
      async loadLatestRecordedStallIds() {
        return ["org-1", "org-2"];
      },
    });

    const result = await sweepStalledClients(deps, NOW);

    assert.equal(result.stalledCount, 2);
    assert.equal(result.newlyStalledCount, 0);
    assert.equal(result.notificationsSent, 0);
    assert.equal(result.changed, false);

    assert.equal(deliveredNotifications.length, 0);
    assert.equal(recordedSweeps.length, 0);
  });

  it("only notifies for newly stalled clients when some were already stalled", async () => {
    // org-1 was already stalled, org-2 is newly stalled
    const { deps, recordedSweeps, deliveredNotifications } = createMockDeps({
      async loadLatestRecordedStallIds() {
        return ["org-1"];
      },
    });

    const result = await sweepStalledClients(deps, NOW);

    assert.equal(result.stalledCount, 2);
    assert.equal(result.newlyStalledCount, 1); // only org-2
    assert.equal(result.changed, true);

    // Only org-2 notifications dispatched (2 admins)
    assert.equal(deliveredNotifications.length, 2);
    assert.ok(deliveredNotifications.every((n) => n.orgId === "org-2"));

    assert.equal(recordedSweeps.length, 1);
    assert.deepEqual(recordedSweeps[0].newly, ["org-2"]);
  });

  it("gracefully continues when an individual notification fails", async () => {
    let callCount = 0;
    const { deps, deliveredNotifications } = createMockDeps({
      async notifyStalled({ recipientUserId, organisationId, payload }) {
        callCount++;
        // First notification fails
        if (callCount === 1) return false;
        deliveredNotifications.push({
          recipient: recipientUserId,
          orgId: organisationId,
          title: payload.title,
          body: payload.body,
        });
        return true;
      },
    });

    const result = await sweepStalledClients(deps, NOW);

    assert.equal(result.newlyStalledCount, 2);
    // 5 total attempts, 1 failed, 4 sent
    assert.equal(result.notificationsSent, 4);
    assert.equal(deliveredNotifications.length, 4);
  });
});
