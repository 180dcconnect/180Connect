import assert from "node:assert/strict";
import test from "node:test";
import {
  checkScheduledAttachmentSet,
  deliverDueScheduledEmails,
  type AttachmentLoadResult,
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
    attachFlyer: false,
    ...overrides,
  };
}

/** Harness: records each port call so tests can assert ordering and arguments. */
function harness(options: {
  due?: DueScheduledMessage[];
  suppressed?: boolean;
  claimResult?: "claimed" | "daily_limit_reached" | "lost_claim";
  attachments?: AttachmentLoadResult;
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
      return options.claimResult ?? "claimed";
    },
    async loadAttachments(id) {
      calls.push(`loadAttachments:${id}`);
      return options.attachments ?? { ok: true, attachments: [] };
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
    `loadAttachments:00000000-0000-4000-d000-000000000001`,
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

test("an exhausted daily send limit blocks the delivery before any Gmail call", async () => {
  // F128: the daily cap is enforced inside the same atomic claim as the
  // per-message lock (claim_scheduled_outreach_send) — it cannot be a
  // separate pre-check without reopening the race two concurrent claims
  // would otherwise hit, so this loop sees it as a claim() outcome, not a
  // gate ahead of the claim.
  const { deps, calls } = harness({ due: [message()], claimResult: "daily_limit_reached" });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 1, failed: 0 });
  // Same transient treatment as F227's per-CAM block — the message stays
  // scheduled, it is NOT failed and its scheduler is not notified.
  assert.ok(calls.includes(`claim:00000000-0000-4000-d000-000000000001`), "the claim was still attempted");
  assert.ok(!calls.some((c) => c.startsWith("deliver:")), "no delivery when over the daily limit");
  assert.ok(!calls.some((c) => c.startsWith("markFailed:") || c.startsWith("notify:")), "a transient daily-limit block must not fail the message");
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
  const { deps, calls } = harness({ due: [message()], claimResult: "lost_claim" });
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
      return id.endsWith("3") ? "lost_claim" : "claimed"; // third message lost to a concurrent runner
    },
    async loadAttachments() {
      return { ok: true, attachments: [] };
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

test("a scheduled send carries the flyer exactly as an immediate send does", async () => {
  const seen: boolean[] = [];
  const { deps } = harness({
    due: [
      message({ attachFlyer: true }),
      message({ id: "00000000-0000-4000-d000-000000000002", attachFlyer: false }),
    ],
  });
  const recording: ScheduledOutreachDeps = {
    ...deps,
    async deliver(input) {
      seen.push(input.attachFlyer);
      return { ok: true, providerMessageId: "pm-1" };
    },
  };
  await deliverDueScheduledEmails(recording, new Date("2026-09-01T10:00:00Z"));
  // Read from the row, so the draft's wording about what is enclosed still
  // holds hours later with no UI and no CAM present to re-tick a box.
  assert.deepEqual(seen, [true, false]);
});

test("linked files resolve after the claim and ride along to deliver", async () => {
  const files = [
    { filename: "scope.pdf", contentType: "application/pdf", content: Buffer.from("pdf-bytes") },
    { filename: "budget.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: Buffer.from("sheet-bytes") },
  ];
  const seen: string[][] = [];
  const { deps, calls } = harness({ due: [message()], attachments: { ok: true, attachments: files } });
  const recording: ScheduledOutreachDeps = {
    ...deps,
    async deliver(input) {
      calls.push(`deliver:${input.recipient}`);
      seen.push(input.attachments.map((file) => file.filename));
      return { ok: true, providerMessageId: "pm-1" };
    },
  };
  const summary = await deliverDueScheduledEmails(recording);
  assert.deepEqual(summary, { sent: 1, blocked: 0, failed: 0 });
  assert.deepEqual(seen, [["scope.pdf", "budget.xlsx"]]);
  // Bytes are only fetched for the message this run owns: suppressed,
  // over-limit and lost-claim rows never pay a download.
  const claimAt = calls.findIndex((c) => c.startsWith("claim:"));
  const loadAt = calls.findIndex((c) => c.startsWith("loadAttachments:"));
  const deliverAt = calls.findIndex((c) => c.startsWith("deliver:"));
  assert.ok(claimAt !== -1 && loadAt > claimAt && deliverAt > loadAt, "claim, then resolve, then deliver");
});

test("a lost claim never resolves attachments — another runner owns the bytes", async () => {
  const { deps, calls } = harness({ due: [message()], claimResult: "lost_claim" });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 0 });
  assert.ok(!calls.some((c) => c.startsWith("loadAttachments:")), "no download for a message this run does not own");
});

test("a permanently missing file fails the message and tells the scheduler", async () => {
  const reason = "One of the attached files could not be found. Nothing was sent.";
  const { deps, calls } = harness({
    due: [message()],
    attachments: { ok: false, reason, retryable: false },
  });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 0, failed: 1 });
  assert.ok(!calls.some((c) => c.startsWith("deliver:")), "nothing may leave short of the reviewed files");
  assert.ok(calls.some((c) => c.startsWith("markFailed:") && c.includes(reason)));
  assert.ok(calls.some((c) => c.startsWith("notify:")));
});

test("a transient download failure stays scheduled for the next run", async () => {
  const { deps, calls } = harness({
    due: [message()],
    attachments: { ok: false, reason: "The attached files could not be downloaded. Nothing was sent.", retryable: true },
  });
  const summary = await deliverDueScheduledEmails(deps);
  assert.deepEqual(summary, { sent: 0, blocked: 1, failed: 0 });
  // Same treatment as the rate-limit blocks: transient by construction, so no
  // failure record and no notification — the next run retries the download.
  assert.ok(!calls.some((c) => c.startsWith("deliver:")));
  assert.ok(!calls.some((c) => c.startsWith("markFailed:") || c.startsWith("notify:")));
});

test("checkScheduledAttachmentSet enforces the shared caps", async () => {
  assert.equal(checkScheduledAttachmentSet([]), null);
  assert.equal(checkScheduledAttachmentSet([{ sizeBytes: 100 }]), null);
  // Null sizes (rows predating size tracking) count as zero, like the send path.
  assert.equal(checkScheduledAttachmentSet([{ sizeBytes: null }]), null);
  assert.match(
    checkScheduledAttachmentSet(Array.from({ length: 11 }, () => ({ sizeBytes: 10 }))) ?? "",
    /at most 10 attachments/,
  );
  assert.match(
    checkScheduledAttachmentSet([{ sizeBytes: 19 * 1024 * 1024 }]) ?? "",
    /too large to send together/,
  );
});
