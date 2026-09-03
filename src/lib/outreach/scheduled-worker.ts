import { reportError } from "../error-logging.ts";
import { logSecurityEvent } from "../log-security-event.ts";
import { emailHtmlToPlainText } from "./email-html.ts";
import { resolveEmailSendLimit } from "./send-rate-limit.ts";

/**
 * The Supabase/Gmail adapters are imported lazily inside sendDueReviewedEmails,
 * not statically: the unit tests exercise deliverDueScheduledEmails directly
 * with injected ports, so they never load the admin client or Gmail transport
 * at all (the former also has an extensionless internal import Node ESM cannot
 * resolve).

/**
 * F126 due worker. Only messages explicitly placed in scheduled state are
 * eligible — drafts are never touched here, so nothing reaches Gmail that a
 * human did not first review and approve through schedule_outreach_send.
 *
 * The per-message flow mirrors F123's manual send path claim-for-claim: each
 * message is atomically CLAIMED (send_claimed_at, the same column and
 * staleness window the manual path uses) before Gmail is called, so exactly
 * one of N concurrent runs can deliver it, and cancel_outreach_schedule
 * refuses while a fresh claim is held — a CAM cannot cancel an email that is,
 * at that exact moment, already leaving.
 *
 * The delivery loop itself is pure over the ScheduledOutreachDeps port below;
 * sendDueReviewedEmails is the only thing that touches Supabase/Gmail, so the
 * failure paths (suppression skip, provider refusal, lost claim) are unit
 * testable without a database or network (issue #122 testing notes).
 *
 * F129 (#124): a delivery that cannot leave must never loop silently. A
 * provider refusal, an active suppression, a missing recipient or a missing
 * sender flips the message scheduled→failed through mark_outreach_send_failed
 * (SEND_EVENTS 'failed' row + audit_log in the same transaction) and notifies
 * the CAM who scheduled it. Only the F227 rate-limit block stays 'scheduled' —
 * that one is transient by construction (the window passes) and re-fires next
 * run without human attention.
 */

/** Upper bound per cron invocation; anything still due rolls to the next run. */
const BATCH_LIMIT = 50;

export type DueScheduledMessage = {
  id: string;
  organisationId: string;
  /** The CAM who scheduled this email (F227 attribution for the send limit). */
  sentByUserId: string | null;
  subject: string;
  /** Sanitised HTML body, exactly what schedule_outreach_send stored. */
  html: string;
  text: string;
  /** Null when neither the contact nor the organisation has an address on
   * file — such a message can never leave and is failed, not skipped. */
  recipient: string | null;
};

export type DeliveryOutcome =
  | { ok: true; providerMessageId?: string; providerThreadId?: string }
  | { ok: false; reason: string };

export type ScheduledOutreachDeps = {
  /** Due messages (send_status='scheduled', scheduled_at <= now), oldest due first. */
  loadDue(nowIso: string): Promise<DueScheduledMessage[]>;
  /** True iff an ACTIVE suppression exists for this organisation. */
  isSuppressed(organisationId: string): Promise<boolean>;
  /** F227: false when the scheduler's fixed-window email quota is exhausted,
   * or the count cannot be verified (fail-closed). */
  underSendLimit(sentByUserId: string): Promise<boolean>;
  /**
   * Atomically claims a message for delivery, via claim_scheduled_outreach_send
   * (20260912180100). 'daily_limit_reached': F128's branch-wide cap is
   * exhausted right now — every CAM shares the one branch mailbox, so this is
   * checked inside the same claim as the per-message lock (splitting the two
   * into separate calls cannot be made atomic — see that migration's header).
   * Reported in the run summary, same treatment as the F227 block below.
   * 'lost_claim': cancelled elsewhere, claimed by another worker, or raced
   * away — silent, never call Gmail on it. 'claimed': proceed to deliver().
   */
  claim(messageId: string, nowIso: string): Promise<"claimed" | "daily_limit_reached" | "lost_claim">;
  deliver(input: { recipient: string; subject: string; text: string; html: string }): Promise<DeliveryOutcome>;
  /** Flips scheduled→sent. False means the flip matched no rows — reported,
   * not retried, since the email may already be out (F123's rule).
   * organisationId lets the F097 score snapshot ride the same RPC call. */
  markSent(
    messageId: string,
    organisationId: string,
    outcome: Extract<DeliveryOutcome, { ok: true }>,
    sentAtIso: string,
  ): Promise<boolean>;
  /** F129: scheduled→failed via mark_outreach_send_failed (SEND_EVENTS +
   * audit_log atomically). False = raced away (cancelled/decided elsewhere);
   * never notified in that case. */
  markFailed(messageId: string, reason: string): Promise<boolean>;
  /** F129 AC1: tells the CAM who scheduled the email that its delivery
   * failed. Best-effort — a notification outage must not fail the run. */
  notifySendFailed(recipientUserId: string, messageId: string, organisationId: string, reason: string): Promise<void>;
};

export type ScheduledRunSummary = { sent: number; blocked: number; failed: number };

export async function deliverDueScheduledEmails(
  deps: ScheduledOutreachDeps,
  now = new Date(),
): Promise<ScheduledRunSummary> {
  const nowIso = now.toISOString();
  const due = await deps.loadDue(nowIso);
  const summary: ScheduledRunSummary = { sent: 0, blocked: 0, failed: 0 };

  for (const message of due) {
    // F129: a message with no address on file can never leave — fail it now
    // (visible to the CAM, retryable once an email exists) rather than letting
    // it sit scheduled forever.
    if (!message.recipient) {
      if (
        await deps.markFailed(message.id, "No recipient email address is on file for this client.")
      ) {
        summary.failed += 1;
        continue;
      }
      summary.blocked += 1;
      continue;
    }

    // DNC re-checked at point-of-send, not just at schedule time: a client can
    // be suppressed after the CAM queued the email, and the suppression wins.
    // F129: that refusal is permanent for this attempt — the message is failed
    // (and its scheduler told) instead of being re-skipped on every run; if
    // the suppression is later lifted, retry re-runs every check.
    if (await deps.isSuppressed(message.organisationId)) {
      const suppressedReason =
        "This client is suppressed, so the scheduled email was not sent.";
      if (await deps.markFailed(message.id, suppressedReason)) {
        summary.failed += 1;
        if (message.sentByUserId) {
          await deps.notifySendFailed(
            message.sentByUserId,
            message.id,
            message.organisationId,
            suppressedReason,
          );
        }
        continue;
      }
      summary.blocked += 1;
      continue;
    }

    // F227: a scheduled delivery counts against its scheduler's send limit.
    // Deliberately NOT failed (F129): the block is transient — the window
    // passes — so the message stays scheduled and goes out on a later run.
    // An unattributable message cannot be limit-checked at all: nothing may
    // leave without a known sender, and it would loop here forever, so it is
    // failed outright.
    if (!message.sentByUserId) {
      if (
        await deps.markFailed(message.id, "No sender was recorded for this email, so it cannot be sent safely.")
      ) {
        summary.failed += 1;
        continue;
      }
      summary.blocked += 1;
      continue;
    }
    if (!(await deps.underSendLimit(message.sentByUserId))) {
      summary.blocked += 1;
      continue;
    }

    // The atomic claim: only one concurrent runner (or a later cron firing
    // while one is still in flight) gets 'claimed' for the same message.
    // F128: the branch-wide daily cap is enforced inside this same claim,
    // under a lock that serializes every concurrent claim attempt (this
    // worker, another run, or a manual send) — see claim_scheduled_
    // outreach_send's migration header for why the cap check cannot be a
    // separate call. Same transient treatment as the F227 block above: stays
    // scheduled, not failed, since the cap resets at midnight UTC and needs
    // no human attention.
    const claim = await deps.claim(message.id, nowIso);
    if (claim === "daily_limit_reached") {
      logSecurityEvent("outreach.daily_send_limit_reached", { messageId: message.id });
      await reportError(new Error("Scheduled delivery blocked: the branch-wide daily send limit has been reached."), {
        operation: "outreach.scheduler.daily_limit_reached",
        messageId: message.id,
      });
      summary.blocked += 1;
      continue;
    }
    if (claim !== "claimed") continue;

    const outcome = await deps.deliver({
      recipient: message.recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (!outcome.ok) {
      // F129 AC1/AC2: record the failure durably and tell the CAM — never a
      // silent skip-and-retry-forever loop.
      if (await deps.markFailed(message.id, outcome.reason)) {
        summary.failed += 1;
        if (message.sentByUserId) {
          await deps.notifySendFailed(
            message.sentByUserId,
            message.id,
            message.organisationId,
            outcome.reason,
          );
        }
        continue;
      }
      summary.blocked += 1;
      continue;
    }
    if (await deps.markSent(message.id, message.organisationId, outcome, nowIso)) {
      summary.sent += 1;
    } else {
      summary.failed += 1;
    }
  }
  return summary;
}

type ScheduledRow = {
  id: string;
  organisation_id: string;
  sent_by_user_id: string | null;
  subject: string;
  body: string;
  contacts: { email: string | null } | null;
  organisations: { contact_email: string | null } | null;
};

/** Cron entry point: wires the port to Supabase (service role) and Gmail. */
export async function sendDueReviewedEmails(now = new Date()): Promise<ScheduledRunSummary> {
  // Lazy adapters — see the module comment for why these are not static imports.
  const { createAdminClient } = await import("../supabase/admin.ts");
  const { sendBranchOutreach } = await import("../gmail/branch-sender.ts");
  const admin = createAdminClient();
  if (!admin) throw new Error("Scheduled outreach is not configured.");

  return deliverDueScheduledEmails(
    {
      async loadDue(nowIso) {
        const { data, error } = await admin
          .from("outreach_messages")
          .select("id, organisation_id, sent_by_user_id, subject, body, contacts(email), organisations(contact_email)")
          .eq("send_status", "scheduled")
          .lte("scheduled_at", nowIso)
          .order("scheduled_at", { ascending: true })
          .limit(BATCH_LIMIT)
          .returns<ScheduledRow[]>();
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          organisationId: row.organisation_id,
          sentByUserId: row.sent_by_user_id,
          subject: row.subject,
          html: row.body,
          // The stored body is sanitised HTML (F117) — the plain-text MIME
          // part must be derived from it, exactly like the manual send path,
          // not the markup itself.
          text: emailHtmlToPlainText(row.body),
          // F129: kept null rather than filtered out so the loop can fail the
          // message visibly instead of it looping as invisible scheduled rows.
          recipient: row.contacts?.email ?? row.organisations?.contact_email ?? null,
        }));
      },

      async isSuppressed(organisationId) {
        const { data, error } = await admin
          .from("suppressions")
          .select("id")
          .eq("organisation_id", organisationId)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();
        if (error || data) return true;
        return false;
      },

      // F227: same fixed-window count the manual send path enforces — a
      // scheduled delivery is an email the scheduler sent, just later. An
      // unresolvable count fails closed (over limit).
      async underSendLimit(sentByUserId) {
        const limit = resolveEmailSendLimit();
        const windowStart = new Date(now.getTime() - limit.windowSeconds * 1000).toISOString();
        const { count, error } = await admin
          .from("outreach_messages")
          .select("id", { count: "exact", head: true })
          .eq("sent_by_user_id", sentByUserId)
          .eq("send_status", "sent")
          .gte("sent_at", windowStart);
        if (error || count === null) {
          await reportError(error ?? new Error("Send-limit count returned no total."), {
            operation: "outreach.scheduler.rate_limit",
          });
          logSecurityEvent("outreach.send_rate_limit_unavailable", {
            userId: sentByUserId,
            cause: error?.message ?? "no count returned",
          });
          return false;
        }
        if (count >= limit.maximum) {
          logSecurityEvent("outreach.send_rate_limited", {
            userId: sentByUserId,
            windowSeconds: limit.windowSeconds,
            sentInWindow: count,
          });
          return false;
        }
        return true;
      },

      async claim(messageId, nowIso) {
        // F128/F129: claim_scheduled_outreach_send (20260912180100) folds the
        // per-message claim (conditional on still-scheduled AND unclaimed, or
        // claim gone stale — same rule the raw UPDATE this replaces used) and
        // the branch-wide daily-cap check into one atomic call, under a lock
        // that serializes every concurrent claim attempt. A network/RPC-level
        // error fails closed, same as an unresolvable count did before.
        const { data, error } = await admin.rpc("claim_scheduled_outreach_send", {
          p_message_id: messageId,
          p_claimed_at: nowIso,
        });
        if (error) {
          await reportError(error, { operation: "outreach.scheduler.claim", messageId });
          return "lost_claim";
        }
        return data as "claimed" | "daily_limit_reached" | "lost_claim";
      },

      async deliver({ recipient, subject, text, html }) {
        // F117: HTML body travels as sanitised HTML plus its derived plain-text
        // part — identical MIME shape to the manual send path.
        const result = await sendBranchOutreach({ to: recipient, subject, text, html });
        if (!result.ok) {
          await reportError(new Error(result.reason), {
            operation: "outreach.scheduler.deliver",
          });
          return { ok: false, reason: result.reason };
        }
        return {
          ok: true,
          providerMessageId: result.providerMessageId,
          providerThreadId: result.providerThreadId,
        };
      },

      // F129: the scheduled→failed flip goes through the audited RPC so the
      // SEND_EVENTS 'failed' row and audit_log entry land atomically with the
      // status change (docs/audit-log-pattern.md §1).
      async markFailed(messageId, reason) {
        const { data: failed, error } = await admin
          .rpc("mark_outreach_send_failed", {
            p_message_id: messageId,
            p_reason: reason,
          });
        if (error) {
          await reportError(error, { operation: "outreach.scheduler.mark_failed", messageId });
          return false;
        }
        if (!failed) {
          await reportError(new Error("Failed-flip matched no rows — the message was decided elsewhere mid-run."), {
            operation: "outreach.scheduler.mark_failed",
            messageId,
          });
        }
        return failed === true;
      },

      // F129 AC1: the CAM who queued this email hears about the failure in-app
      // (F173 producer RPC; service_role is an allowed system producer).
      // Best-effort by design — never fail the run over a notification.
      async notifySendFailed(recipientUserId, messageId, organisationId, reason) {
        const { error } = await admin.rpc("create_notification", {
          p_recipient_user_id: recipientUserId,
          p_notification_type: "outreach_send_failed",
          p_title: "A scheduled email could not be sent",
          p_body: reason,
          p_link_path: `/clients/${organisationId}`,
          p_target_table: "outreach_messages",
          p_target_id: messageId,
          p_actor_user_id: null,
        });
        if (error) {
          await reportError(error, { operation: "outreach.scheduler.notify", messageId });
        }
      },

      async markSent(messageId, organisationId, outcome, sentAtIso) {
        // F157: the whole recordal is one audited RPC — claim-pinned
        // scheduled→sent flip, SEND_EVENTS 'sent' row, outreach_email_sent
        // audit entry, AND the client's pipeline advance, in one transaction.
        // The claim token is this run's nowIso, the same value the claim step
        // wrote into send_claimed_at, so only the run that owns the message can
        // record it. False = raced away (cancelled/re-claimed mid-delivery):
        // the email MAY already be out, so it is reported as ambiguous and
        // never retried (F123's duplicate-email rule).
        //
        // F097: the point-in-time scoring vector rides the same call — built
        // from pre-send state (the RPC's own advance happens inside its
        // transaction, after this read). Best-effort: a failed build logs and
        // passes null rather than failing a delivered email.
        const { buildScoreSnapshot } = await import("../scoring/build-score-snapshot.ts");
        const scoreSnapshot = await buildScoreSnapshot(organisationId);
        const { data: flipped, error } = await admin.rpc("mark_scheduled_outreach_delivered", {
          p_message_id: messageId,
          p_provider_message_id: outcome.providerMessageId ?? null,
          p_provider_thread_id: outcome.providerThreadId ?? null,
          p_claim_token: sentAtIso,
          p_score_snapshot: scoreSnapshot,
        });
        if (error) {
          await reportError(error, {
            operation: "outreach.scheduler.record",
            messageId,
          });
          return false;
        }
        if (flipped !== true) {
          await reportError(new Error("Sent-flip matched no rows — the message was cancelled or re-claimed mid-delivery. The email MAY already be out."), {
            operation: "outreach.scheduler.record",
            messageId,
          });
          return false;
        }
        return true;
      },
    },
    now,
  );
}
