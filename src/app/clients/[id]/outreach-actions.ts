"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { canSendClientOutreach } from "@/lib/client-email-validation";
import { reportError } from "@/lib/error-logging";
import { sendBranchOutreach } from "@/lib/gmail/branch-sender";
import { emailHtmlToPlainText, sanitizeEmailHtml } from "@/lib/outreach/email-html";
import { reviewedEmailSchema } from "@/lib/outreach/send-reviewed";
import { checkSuppressionBeforeSend, suppressionBlockedMessage } from "@/lib/outreach/suppression-check";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";

export type ReviewedSendResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** F123/F250: the sole deliberate, human-approved outreach send action. */
export async function sendReviewedEmail(input: unknown): Promise<ReviewedSendResult> {
  const parsed = safeValidate(reviewedEmailSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      message: Object.values(parsed.fieldErrors).flat().find(Boolean) ?? "Check the email and try again.",
    };
  }

  const authorization = await getCurrentActor("client:contact", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  const isAdmin = authorization.actor.role === "admin";

  const { organisationId, messageId, recipient, subject, explicitlyApproved } = parsed.data;
  // F117: never trust client-side sanitization alone — this is the one place
  // that decides what actually gets stored and sent, regardless of what
  // reached this action. Re-checked for real content after sanitizing, not
  // just after the schema's own check on the raw input: a body built entirely
  // out of disallowed markup (never producible by the editor itself, but not
  // ruled out for a request built by hand) could pass schema validation and
  // still sanitize down to nothing.
  const body = sanitizeEmailHtml(parsed.data.body);
  if (emailHtmlToPlainText(body).length === 0) {
    return { ok: false, message: "Add email content before sending." };
  }
  const supabase = await createClient();
  const { data: draft, error: draftError } = await supabase
    .from("outreach_messages")
    .select("id, organisation_id, contact_id, send_status, sent_by_user_id")
    .eq("id", messageId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (draftError || !draft) {
    if (draftError) await reportError(draftError, { operation: "outreach.send.load_draft", messageId });
    return { ok: false, message: "That draft could not be loaded. Refresh and try again." };
  }
  if (draft.send_status !== "draft") {
    return { ok: false, message: "This email is no longer an unsent draft." };
  }

  // F123 AC4 — the "unauthorised sender" case: RLS lets every active user READ
  // every draft, and would only silently no-op a foreign UPDATE, so ownership has
  // to be asserted here before anything is sent. The RPCs below re-check it
  // inside their SECURITY DEFINER bodies regardless; this early return just gives
  // the honest UI error instead of a confusing later one.
  if (!isAdmin && draft.sent_by_user_id !== authorization.actor.id) {
    return { ok: false, message: "You can only send drafts you generated yourself." };
  }

  const suppression = await checkSuppressionBeforeSend(organisationId, async (id) => {
    const { data, error } = await supabase
      .from("suppressions")
      .select("id, reason")
      .eq("organisation_id", id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  });
  if (!suppression.allowed) {
    return {
      ok: false,
      message: suppression.kind === "suppressed"
        ? suppressionBlockedMessage(suppression.reason)
        : "Suppression status could not be verified. Nothing was sent.",
    };
  }

  // F116: the recipient is whatever the CAM reviewed and approved, not a value
  // re-derived from the contact/organisation record — same rule subject and body
  // already follow. The editor warns on a mismatch against the record but does
  // not block one; this is the only server-side gate, re-checking the exact
  // format rule F045 uses regardless of what the client-side check already did.
  const decision = canSendClientOutreach(recipient, explicitlyApproved);
  if (!decision.allowed) return { ok: false, message: decision.warning };

  // Save the exact reviewed content first, and REQUIRE the write to have matched:
  // `.eq(send_status)` + `.single()` turns a raced or already-sent draft into an
  // error here rather than a silent zero-row update that Gmail then makes real.
  // A failed provider call leaves an editable draft containing precisely what the
  // CAM attempted, never the earlier AI output.
  //
  // sent_by_user_id deliberately records whoever actually hit Send, including an
  // admin sending another CAM's generated draft — "who sent an email is a fact
  // about the email" (create_outreach.sql), and the audit_log row written by
  // mark_outreach_sent carries the same actor.
  //
  // sent_to_email (F116 review follow-up): persist exactly who this attempt
  // targets alongside the reviewed content, so even a failed or ambiguous send
  // leaves a trace of who the CAM aimed at rather than only the on-file record.
  const { data: saved, error: saveError } = await supabase
    .from("outreach_messages")
    .update({ subject, body, sent_to_email: decision.recipient, sent_by_user_id: authorization.actor.id })
    .eq("id", messageId)
    .eq("organisation_id", organisationId)
    .eq("send_status", "draft")
    .select("id")
    .single();
  if (saveError || !saved) {
    await reportError(saveError ?? new Error("Draft save matched no rows."), { operation: "outreach.send.save_review", messageId });
    return { ok: false, message: "This email is no longer an unsent draft." };
  }

  // Atomic claim (F123): exactly one concurrent sender may proceed to Gmail for
  // this draft; everyone else gets refused before any provider call. The claim
  // self-expires after send_claim_staleness_window(), so a crashed tab cannot lock
  // a draft forever.
  const { data: claimed, error: claimError } = await supabase
    .rpc("claim_outreach_send", { p_message_id: messageId });
  if (claimError) {
    await reportError(claimError, { operation: "outreach.send.claim", messageId });
    return { ok: false, message: "The send could not be started safely. Nothing was sent. Try again." };
  }
  if (claimed !== true) {
    return { ok: false, message: "This email is already being sent, or was just sent. Refresh to see its current state." };
  }

  const sent = await sendBranchOutreach({
    to: decision.recipient,
    subject,
    text: emailHtmlToPlainText(body),
    html: body,
  });

  if (!sent.ok) {
    // Definite refusal (bad credentials, suppressed-at-provider, malformed
    // request): nothing went out, so release the claim for a clean retry. An
    // ambiguous failure (timeout/5xx — the email may actually have been delivered)
    // deliberately KEEPS the claim: auto-retrying an unknown-outcome send risks a
    // duplicate email to the client, which is worse than asking a human to check
    // the mailbox. Stale claims expire via send_claim_staleness_window().
    if (!sent.retryable) {
      const { error: unclaimError } = await supabase
        .from("outreach_messages")
        .update({ send_claimed_at: null })
        .eq("id", messageId)
        .eq("send_status", "draft");
      if (unclaimError) {
        await reportError(unclaimError, { operation: "outreach.send.unclaim", messageId });
      }
    } else {
      await reportError(new Error(`Gmail send failed with retryable outcome (${sent.reason}).`), {
        operation: "outreach.send.ambiguous_failure",
        messageId,
      });
    }
    return { ok: false, message: sent.retryable
      ? `${sent.reason} If you are unsure whether it went out, check the mailbox before retrying.`
      : sent.reason };
  }

  // Audited draft→sent transition (F123/audit-log pattern §1): the RPC flips the
  // status conditionally on still-draft and writes the audit_log row in the same
  // transaction, so a lost race raises instead of double-recording. The reviewed
  // recipient is passed explicitly (F116 review follow-up) so the audited fact is
  // exactly what the transport was given, not a value re-derived at recordal time.
  const { error: markError } = await supabase.rpc("mark_outreach_sent", {
    p_message_id: messageId,
    p_provider_message_id: sent.providerMessageId,
    p_provider_thread_id: sent.providerThreadId,
    p_recipient_email: decision.recipient,
  });
  if (markError) {
    // The email IS out; this must stay visible even though the request succeeds
    // overall — the DoD requires failures to reach ERROR_LOG.
    await reportError(markError, { operation: "outreach.send.record_sent", messageId });
    return { ok: false, message: "The email was sent, but its status could not be recorded. Contact an administrator." };
  }

  const admin = createAdminClient();
  if (admin) {
    // Best-effort delivery record: the send itself is already durable in
    // outreach_messages + audit_log above; this enriches the timeline only.
    const { error: eventError } = await admin.from("send_events").insert({
      outreach_message_id: messageId,
      event_type: "sent",
      occurred_at: new Date().toISOString(),
      metadata: {
        provider: "gmail",
        message_id: sent.providerMessageId,
        thread_id: sent.providerThreadId,
        recipient: decision.recipient,
      },
    });
    if (eventError) await reportError(eventError, { operation: "outreach.send.record_event", messageId });
  }

  // Pipeline advance via set_outreach_status (its own audited RPC). Best-effort by
  // design — the email is factually out either way, and a failed status flip is
  // reported above rather than pretending the send didn't happen.
  const { data: organisationRow } = await supabase
    .from("organisations")
    .select("outreach_status")
    .eq("id", organisationId)
    .single();
  const nextStatus = organisationRow?.outreach_status === "not_contacted"
    ? "initial_outreach_sent"
    : "follow_up_sent";
  const { error: pipelineError } = await supabase.rpc("set_outreach_status", {
    p_org_id: organisationId,
    p_new_status: nextStatus,
  });
  if (pipelineError) await reportError(pipelineError, { operation: "outreach.send.pipeline", messageId });

  revalidatePath(`/clients/${organisationId}`);
  return { ok: true, message: "Email sent from the Sheffield outreach mailbox." };
}
