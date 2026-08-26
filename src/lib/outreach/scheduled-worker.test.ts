import assert from "node:assert/strict";
import test from "node:test";
import {
  deliverDueScheduledEmails,
  type DueScheduledMessage,
  type ScheduledOutreachDeps,
} from "./scheduled-worker.ts";

/**
 * F126 worker loop tests (issue #122 testing notes). The port interface keeps
 * Supabase/Gmail out of these — every branch that matters is a decision the
 * loop makes on its own: suppression skip leaves the row queued, a lost claim
 * or provider refusal counts as failed without touching markSent, and an
 * ambiguous sent-flip is reported as failed rather than counted as sent.
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
      return options.delivery === "failed" ? { ok: false } : { ok: true, providerMessageId: "pm-1" };
    },
    async markSent(id) {
      calls.push(`markSent:${id}`);
      return options.flipSucceeds ?? true;
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
  assert.ok(!calls.some((c) => c.startsWith("claim:") || c.startsWith("deliver:")), "no claim or delivery when over the F227 limit");
});

test("an unattributable scheduled email is counted failed, never delivered", async () => {
  // No sent_by_user_id = no one to bill the send against; F227's rule is that
  // nothing leaves without a known sender.
  const { deps, calls } = harness({ due: [message({ sentByUserId: null })] });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 1 });
  assert.ok(!calls.some((c) => c.startsWith("deliver:") || c.startsWith("underSendLimit:")));
});

test("a suppressed client's scheduled email is skipped, never handed to Gmail", async () => {
  const { deps, calls } = harness({ due: [message()], suppressed: true });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 1, failed: 0 });
  assert.ok(!calls.some((c) => c.startsWith("claim:") || c.startsWith("deliver:")), "no claim or delivery after suppression");
});

test("a lost claim delivers nothing — another runner won the message", async () => {
  const { deps, calls } = harness({ due: [message()], claimWon: false });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 0 });
  assert.ok(!calls.some((c) => c.startsWith("deliver:")), "Gmail must not be called on a lost claim");
});

test("a provider refusal counts as failed and never touches markSent", async () => {
  const { deps, calls } = harness({ due: [message()], delivery: "failed" });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 1 });
  assert.ok(calls.includes(`claim:00000000-0000-4000-d000-000000000001`), "the claim was still attempted first");
  assert.ok(!calls.some((c) => c.startsWith("markSent:")));
});

test("an ambiguous sent-flip is reported as failed, not silently as sent", async () => {
  // The email MAY be out; counting it as sent would hide the ambiguity the
  // F123 duplicate-email rule exists to prevent.
  const { deps } = harness({ due: [message()], flipSucceeds: false });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 1 });
});

test("mixed outcomes across a batch are counted independently", async () => {
  const batch = [
    message({ id: "00000000-0000-4000-d000-0000000000a1", recipient: "a@example.org" }),
    message({ id: "00000000-0000-4000-d000-0000000000a2", organisationId: "00000000-0000-4000-c000-000000000002", recipient: "b@example.org" }),
    message({ id: "00000000-0000-4000-d000-0000000000a3", recipient: "c@example.org" }),
    message({ id: "00000000-0000-4000-d000-0000000000a4", recipient: "d@example.org" }),
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
      return deliveries === 2 ? { ok: false } : { ok: true }; // fourth fails at Gmail
    },
    async markSent() {
      return true;
    },
  };
  const summary = await deliverDueScheduledEmails(deps);
  // The lost-claim message counts as neither sent nor failed — another runner
  // owns it; it will be that run's outcome.
  assert.deepEqual(summary, { sent: 1, blocked: 1, failed: 1 });
});

test("an empty due list does nothing beyond the load", async () => {
  const { deps, calls } = harness({ due: [] });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 0 });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^loadDue:/);
});
