import { reportError } from "../error-logging.ts";

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
 */

/** How long a delivery claim blocks re-delivery. Mirrors the SQL constant
 * public.send_claim_staleness_window() (20260901110000) — short by design: it
 * only has to cover one Gmail round trip plus timeout. */
const CLAIM_STALENESS_MS = 5 * 60 * 1000;

/** Upper bound per cron invocation; anything still due rolls to the next run. */
const BATCH_LIMIT = 50;

export type DueScheduledMessage = {
  id: string;
  organisationId: string;
  subject: string;
  /** Sanitised HTML body, exactly what schedule_outreach_send stored. */
  html: string;
  text: string;
  recipient: string;
};

export type DeliveryOutcome =
  | { ok: true; providerMessageId?: string; providerThreadId?: string }
  | { ok: false };

export type ScheduledOutreachDeps = {
  /** Due messages (send_status='scheduled', scheduled_at <= now), oldest due first. */
  loadDue(nowIso: string): Promise<DueScheduledMessage[]>;
  /** True iff an ACTIVE suppression exists for this organisation. */
  isSuppressed(organisationId: string): Promise<boolean>;
  /** Atomically claims a message for delivery. False = cancelled elsewhere,
   * claimed by another worker, or raced away — never call Gmail on false. */
  claim(messageId: string, nowIso: string): Promise<boolean>;
  deliver(input: { recipient: string; subject: string; text: string; html: string }): Promise<DeliveryOutcome>;
  /** Flips scheduled→sent. False means the flip matched no rows — reported,
   * not retried, since the email may already be out (F123's rule). */
  markSent(messageId: string, outcome: Extract<DeliveryOutcome, { ok: true }>, sentAtIso: string): Promise<boolean>;
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
    // DNC re-checked at point-of-send, not just at schedule time: a client can
    // be suppressed after the CAM queued the email, and the suppression wins.
    if (await deps.isSuppressed(message.organisationId)) {
      summary.blocked += 1;
      continue;
    }

    // The atomic claim: only one concurrent runner (or a later cron firing
    // while one is still in flight) gets true for the same message.
    if (!(await deps.claim(message.id, nowIso))) continue;

    const outcome = await deps.deliver({
      recipient: message.recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (!outcome.ok) {
      summary.failed += 1;
      continue;
    }
    if (await deps.markSent(message.id, outcome, nowIso)) {
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
  const staleClaimBefore = new Date(now.getTime() - CLAIM_STALENESS_MS).toISOString();

  return deliverDueScheduledEmails(
    {
      async loadDue(nowIso) {
        const { data, error } = await admin
          .from("outreach_messages")
          .select("id, organisation_id, subject, body, contacts(email), organisations(contact_email)")
          .eq("send_status", "scheduled")
          .lte("scheduled_at", nowIso)
          .order("scheduled_at", { ascending: true })
          .limit(BATCH_LIMIT)
          .returns<ScheduledRow[]>();
        if (error) throw error;
        return (data ?? []).flatMap((row) => {
          const recipient = row.contacts?.email ?? row.organisations?.contact_email;
          if (!recipient) return [];
          return [{
            id: row.id,
            organisationId: row.organisation_id,
            subject: row.subject,
            html: row.body,
            text: row.body,
            recipient,
          }];
        });
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

      async claim(messageId, nowIso) {
        // Conditional on still-scheduled AND unclaimed (or claim gone stale),
        // like claim_outreach_send's draft equivalent. Zero rows = someone else
        // won it or the CAM cancelled it between SELECT and here.
        const { data: claimed, error } = await admin
          .from("outreach_messages")
          .update({ send_claimed_at: nowIso })
          .eq("id", messageId)
          .eq("send_status", "scheduled")
          // Quoted per PostgREST or-expression rules — the raw ISO timestamp's
          // colons would otherwise be read as field/op/value separators.
          .or(`send_claimed_at.is.null,send_claimed_at.lt.${JSON.stringify(staleClaimBefore)}`)
          .select("id");
        return !error && (claimed?.length ?? 0) === 1;
      },

      async deliver({ recipient, subject, text, html }) {
        // F117: HTML body travels as sanitised HTML plus its derived plain-text
        // part — identical MIME shape to the manual send path.
        const result = await sendBranchOutreach({ to: recipient, subject, text, html });
        if (!result.ok) {
          await reportError(new Error(result.reason), {
            operation: "outreach.scheduler.deliver",
          });
          return { ok: false };
        }
        return {
          ok: true,
          providerMessageId: result.providerMessageId,
          providerThreadId: result.providerThreadId,
        };
      },

      async markSent(messageId, outcome, sentAtIso) {
        // Pinned to OUR claim (this run's timestamp), not just still-scheduled:
        // a successful Gmail call followed by an unexpected zero-row flip must
        // be reported as ambiguous, never retried (F123's duplicate-email rule).
        const { data: flipped, error } = await admin
          .from("outreach_messages")
          .update({
            send_status: "sent",
            sent_at: sentAtIso,
            scheduled_at: null,
            send_claimed_at: null,
          })
          .eq("id", messageId)
          .eq("send_status", "scheduled")
          .eq("send_claimed_at", sentAtIso)
          .select("id");
        if (error || (flipped?.length ?? 0) !== 1) {
          await reportError(error ?? new Error("Sent-flip matched no rows — the message was cancelled or re-claimed mid-delivery. The email MAY already be out."), {
            operation: "outreach.scheduler.record",
            messageId,
          });
          return false;
        }
        const { error: eventError } = await admin.from("send_events").insert({
          outreach_message_id: messageId,
          event_type: "sent",
          occurred_at: sentAtIso,
          metadata: {
            provider: "gmail",
            message_id: outcome.providerMessageId ?? null,
            thread_id: outcome.providerThreadId ?? null,
            scheduled: true,
          },
        });
        if (eventError) await reportError(eventError, { operation: "outreach.scheduler.record_event", messageId });
        return true;
      },
    },
    now,
  );
}
