import assert from "node:assert/strict";
import test from "node:test";
import {
  deliverDueScheduledEmails,
  type DueScheduledMessage,
  type ScheduledOutreachDeps,
} from "./scheduled-worker.ts";

/**
 * F126 worker loop tests (issue #122 testing notes), extended for F129 (#124):
 * every branch that cannot leave must now fail the message visibly — provider
 * refusal, suppression, missing recipient, missing sender — while the F227
 * rate-limit block deliberately stays scheduled (transient by construction).
 * The port interface keeps Supabase/Gmail out of these — each test is a
 * decision the loop makes on its own.
 */

function message(overrides: Partial<DueScheduledMessage> = {}): DueScheduledMessage {
  return {
    id: "00000000-0000-4000-d000-000000000001",
    organisationId: "00000000-0000-4000-c000-000000000001",
    sentByUserId: "00000000-0000-4000-a000-000000000001",
    subject: "Hello",
    html: "<p>Body</p>",
    text: "Body",
    recipient: "client@example.org",
    ...overrides,
  };
}

/** Harness: records each port call so tests can assert ordering and arguments. */
function harness(options: {
  due?: DueScheduledMessage[];
  suppressed?: boolean;
  claimWon?: boolean;
  delivery?: "ok" | "failed";
  flipSucceeds?: boolean;
  failFlipSucceeds?: boolean;
  underLimit?: boolean;
}) {
  const calls: string[] = [];
  const deps: ScheduledOutreachDeps = {
    async loadDue(nowIso) {
      calls.push(`loadDue:${nowIso}`);
      return options.due ?? [];
    },
    async isSuppressed() {
      calls.push("isSuppressed");
      return options.suppressed ?? false;
    },
    async underSendLimit(sentByUserId) {
      calls.push(`underSendLimit:${sentByUserId}`);
      return options.underLimit ?? true;
    },
    async claim(id) {
      calls.push(`claim:${id}`);
      return options.claimWon ?? true;
    },
    async deliver(input) {
      calls.push(`deliver:${input.recipient}`);
      return options.delivery === "failed"
        ? { ok: false, reason: "Gmail is temporarily unavailable. Try again." }
        : { ok: true, providerMessageId: "pm-1" };
    },
    async markSent(id) {
      calls.push(`markSent:${id}`);
      return options.flipSucceeds ?? true;
    },
    async markFailed(id, reason) {
      calls.push(`markFailed:${id}:${reason}`);
      return options.failFlipSucceeds ?? true;
    },
    async notifySendFailed(recipientUserId, messageId, organisationId) {
      calls.push(`notify:${recipientUserId}:${messageId}:${organisationId}`);
    },
  };
  return { deps, calls };
}

test("a due message is claimed, delivered and marked sent", async () => {
  const { deps, calls } = harness({ due: [message()] });
  const summary = await deliverDueScheduledEmails(deps, new Date("2026-09-01T10:00:00Z"));
  assert.deepEqual(summary, { sent: 1, blocked: 0, failed: 0 });
  assert.deepEqual(calls, [
    "loadDue:2026-09-01T10:00:00.000Z",
    "isSuppressed",
    `underSendLimit:00000000-0000-4000-a000-000000000001`,
    `claim:00000000-0000-4000-d000-000000000001`,
    "deliver:client@example.org",
    "markSent:00000000-0000-4000-d000-000000000001",
  ]);
});

test("an exhausted send limit blocks the delivery before any claim or Gmail call", async () => {
  const { deps, calls } = harness({ due: [message()], underLimit: false });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 1, failed: 0 });
  // F129: the limit block is transient — the message stays scheduled, it is
  // NOT failed and its scheduler is not notified.
  assert.ok(!calls.some((c) => c.startsWith("claim:") || c.startsWith("deliver:")), "no claim or delivery when over the F227 limit");
  assert.ok(!calls.some((c) => c.startsWith("markFailed:") || c.startsWith("notify:")), "a transient rate-limit block must not fail the message");
});

test("an unattributable scheduled email is failed — it would otherwise loop forever", async () => {
  // No sent_by_user_id = no one to bill the send against; F227's rule is that
  // nothing leaves without a known sender. F129's rule is that such a row is
  // failed visibly rather than re-skipped on every cron run.
  const { deps, calls } = harness({ due: [message({ sentByUserId: null })] });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 1 });
  assert.ok(!calls.some((c) => c.startsWith("deliver:") || c.startsWith("underSendLimit:")));
  assert.ok(calls.some((c) => c.startsWith(`markFailed:00000000-0000-4000-d000-000000000001:`)));
  // No known sender means there is nobody to notify either.
  assert.ok(!calls.some((c) => c.startsWith("notify:")));
});

test("a suppressed client's scheduled email is failed and its scheduler told", async () => {
  const { deps, calls } = harness({ due: [message()], suppressed: true });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 1 });
  assert.ok(!calls.some((c) => c.startsWith("claim:") || c.startsWith("deliver:")), "no claim or delivery after suppression");
  assert.ok(
    calls.some((c) => c.includes("This client is suppressed")),
    "the recorded reason names the suppression",
  );
  assert.ok(
    calls.includes(`notify:00000000-0000-4000-a000-000000000001:00000000-0000-4000-d000-000000000001:00000000-0000-4000-c000-000000000001`),
    "F129 AC1: the CAM who scheduled the email learns it did not go out",
  );
});

test("a message with no address on file is failed before anything else runs", async () => {
  const { deps, calls } = harness({ due: [message({ recipient: null })] });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 1 });
  assert.ok(!calls.some((c) => c === "isSuppressed"), "no point checking DNC when nothing can be addressed");
  assert.ok(calls.some((c) => c.includes("No recipient email address")));
});

test("a failed-flip that races away counts as blocked, not failed", async () => {
  // Someone cancelled or decided the message between the loop's checks and the
  // flip — counting a failure here would misreport a row this run never owned.
  const { deps } = harness({ due: [message()], delivery: "failed", failFlipSucceeds: false });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 1, failed: 0 });
});

test("a lost claim delivers nothing — another runner won the message", async () => {
  const { deps, calls } = harness({ due: [message()], claimWon: false });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 0 });
  assert.ok(!calls.some((c) => c.startsWith("deliver:")), "Gmail must not be called on a lost claim");
  assert.ok(!calls.some((c) => c.startsWith("markFailed:") || c.startsWith("notify:")), "another runner owns the outcome");
});

test("a provider refusal is failed durably with its reason and never touches markSent", async () => {
  const { deps, calls } = harness({ due: [message()], delivery: "failed" });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 1 });
  assert.ok(calls.includes(`claim:00000000-0000-4000-d000-000000000001`), "the claim was still attempted first");
  assert.ok(!calls.some((c) => c.startsWith("markSent:")));
  assert.ok(
    calls.some((c) => c.startsWith("markFailed:") && c.includes("Gmail is temporarily unavailable")),
    "F129 AC2: the transport's reason travels into the failure record",
  );
  assert.ok(
    calls.some((c) => c.startsWith("notify:")),
    "the scheduler hears about the failure",
  );
});

test("an ambiguous sent-flip is reported as failed, not silently as sent", async () => {
  // The email MAY be out; counting it as sent would hide the ambiguity the
  // F123 duplicate-email rule exists to prevent. No failure record is written:
  // the message may have left, so failing it outright would invite a duplicate.
  const { deps, calls } = harness({ due: [message()], flipSucceeds: false });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 1 });
  assert.ok(!calls.some((c) => c.startsWith("markFailed:") || c.startsWith("notify:")), "an ambiguous outcome must not be recorded as a definite failure");
});

test("mixed outcomes across a batch are counted independently", async () => {
  const batch = [
    message({ id: "00000000-0000-4000-d000-0000000000a1", recipient: "a@example.org" }),
    message({ id: "00000000-0000-4000-d000-0000000000a2", organisationId: "00000000-0000-4000-c000-000000000002", recipient: "b@example.org" }),
    message({ id: "00000000-0000-4000-d000-0000000000a3", recipient: "c@example.org" }),
    message({ id: "00000000-0000-4000-d000-0000000000a4", recipient: "d@example.org" }),
    message({ id: "00000000-0000-4000-d000-0000000000a5", recipient: null }),
  ];
  let deliveries = 0;
  const deps: ScheduledOutreachDeps = {
    async loadDue() {
      return batch;
    },
    async isSuppressed(organisationId) {
      return organisationId.endsWith("2"); // second message's client was suppressed after scheduling
    },
    async underSendLimit() {
      return true;
    },
    async claim(id) {
      return !id.endsWith("3"); // third message lost to a concurrent runner
    },
    async deliver() {
      deliveries += 1;
      return deliveries === 2 ? { ok: false, reason: "boom" } : { ok: true }; // fifth attempt fails at Gmail
    },
    async markSent() {
      return true;
    },
    async markFailed(id) {
      calls_failures.push(id);
      return true;
    },
    async notifySendFailed() {},
  };
  const calls_failures: string[] = [];
  const summary = await deliverDueScheduledEmails(deps);
  // Sent: first. Failed: second (suppressed), fourth (Gmail refusal), fifth
  // (no recipient). The lost-claim third counts as neither — another runner
  // owns it; it will be that run's outcome.
  assert.deepEqual(summary, { sent: 1, blocked: 0, failed: 3 });
  assert.deepEqual(calls_failures.sort(), [
    "00000000-0000-4000-d000-0000000000a2",
    "00000000-0000-4000-d000-0000000000a4",
    "00000000-0000-4000-d000-0000000000a5",
  ]);
});

test("an empty due list does nothing beyond the load", async () => {
  const { deps, calls } = harness({ due: [] });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 0 });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^loadDue:/);
});
