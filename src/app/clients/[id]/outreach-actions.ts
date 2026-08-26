"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { canSendClientOutreach } from "@/lib/client-email-validation";
import { reportError } from "@/lib/error-logging";
import { sendBranchOutreach } from "@/lib/gmail/branch-sender";
import { discardDraftSchema } from "@/lib/outreach/discard-draft";
import { emailHtmlToPlainText, sanitizeEmailHtml } from "@/lib/outreach/email-html";
import { HUMAN_REVIEW_REQUIRED_MESSAGE, humanReviewDecision } from "@/lib/outreach/human-review";
import { logSecurityEvent } from "@/lib/log-security-event";
import { saveDraftSchema } from "@/lib/outreach/save-draft";
import { reviewedEmailSchema } from "@/lib/outreach/send-reviewed";
import { emailLimitMessage, resolveEmailSendLimit } from "@/lib/outreach/send-rate-limit";
import { checkSuppressionBeforeSend, suppressionBlockedMessage } from "@/lib/outreach/suppression-check";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";
import { z } from "zod";

export type ReviewedSendResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const scheduleSchema = reviewedEmailSchema.extend({ scheduledAt: z.iso.datetime() });

/**
 * F126 (#122): queue a reviewed email for future delivery. Same review gate as
 * sendReviewedEmail — the approval checkbox is required either way — and the
 * same audited-RPC pattern as F123's send path: schedule_outreach_send
 * re-checks authorisation and suppression inside its SECURITY DEFINER body and
 * records the draft→scheduled transition in audit_log in the same transaction.
 */
export async function scheduleReviewedEmail(input: unknown): Promise<ReviewedSendResult> {
  const parsed = safeValidate(scheduleSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      message: Object.values(parsed.fieldErrors).flat().find(Boolean) ?? "Check the schedule and try again.",
    };
  }

  // F121: the human-review checkpoint — scheduling is a commitment to deliver
  // this exact content later, so an unapproved email never gets this far.
  const review = humanReviewDecision("scheduled", parsed.data.explicitlyApproved);
  if (!review.allowed) return { ok: false, message: review.message };

  const authorization = await getCurrentActor("client:contact", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  const isAdmin = authorization.actor.role === "admin";

  // explicitlyApproved has been consumed by the F121 checkpoint above.
  const { organisationId, messageId, subject } = parsed.data;
  // F117: never trust client-side sanitization alone — identical rule to the
  // send path, since what is stored here is exactly what the cron worker will
  // deliver later.
  const body = sanitizeEmailHtml(parsed.data.body);
  if (emailHtmlToPlainText(body).length === 0) {
    return { ok: false, message: "Add email content before scheduling." };
  }
  const supabase = await createClient();

  // F123 AC4's ownership assertion, before the RPC gives a database-shaped error:
  // RLS lets every active user READ every draft, so ownership has to be asserted
  // here for an honest UI message (the RPC re-checks it regardless).
  const { data: draft } = await supabase
    .from("outreach_messages")
    .select("send_status, sent_by_user_id")
    .eq("id", messageId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (!draft || draft.send_status !== "draft") {
    return { ok: false, message: "This email is no longer an unsent draft." };
  }
  if (!isAdmin && draft.sent_by_user_id !== authorization.actor.id) {
    return { ok: false, message: "You can only schedule drafts you generated yourself." };
  }

  // Suppression at point-of-scheduling — the worker re-checks at point-of-send,
  // but refusing here gives the CAM an immediate answer instead of a silent skip.
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
        : "Suppression status could not be verified. Nothing was scheduled.",
    };
  }

  const scheduledAtIso = new Date(parsed.data.scheduledAt);
  if (scheduledAtIso.getTime() <= Date.now()) {
    return { ok: false, message: "Choose a future date and time." };
  }

  // Save the exact reviewed content FIRST, through the app's sanitizing write
  // path, and REQUIRE the write to have matched. The RPC deliberately takes no
  // content parameters (F227-review hardening): a caller that bypasses the app
  // and invokes it directly can only schedule what these paths already saved —
  // never inject raw markup for the cron worker to deliver.
  const { data: saved, error: saveError } = await supabase
    .from("outreach_messages")
    .update({ subject, body, sent_by_user_id: authorization.actor.id })
    .eq("id", messageId)
    .eq("organisation_id", organisationId)
    .eq("send_status", "draft")
    .select("id")
    .single();
  if (saveError || !saved) {
    await reportError(saveError ?? new Error("Draft save matched no rows."), { operation: "outreach.schedule.save_review", messageId });
    return { ok: false, message: "This email is no longer an unsent draft." };
  }

  const { data: scheduled, error } = await supabase.rpc("schedule_outreach_send", {
    p_message_id: messageId,
    p_scheduled_at: scheduledAtIso.toISOString(),
  });
  if (error || !scheduled) {
    await reportError(error ?? new Error("Schedule matched no rows."), { operation: "outreach.schedule", messageId });
    return { ok: false, message: "The email could not be scheduled. Try again." };
  }

  revalidatePath(`/clients/${organisationId}`);
  return { ok: true, message: `Email scheduled for ${scheduledAtIso.toLocaleString("en-GB")}.` };
}

/**
 * F126 AC: cancel a pending schedule. Goes through cancel_outreach_schedule
 * because RLS pins every direct outreach_messages UPDATE to draft rows — a
 * plain client update could never un-schedule anything. The RPC re-checks
 * authorisation and audits scheduled→draft in the same transaction.
 */
export async function cancelScheduledEmail(input: unknown): Promise<ReviewedSendResult> {
  const parsed = safeValidate(z.object({ organisationId: z.uuid(), messageId: z.uuid() }), input);
  if (!parsed.success) {
    return { ok: false, message: "That scheduled email could not be identified." };
  }
  const authorization = await getCurrentActor("client:contact", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  const supabase = await createClient();
  const { data: cancelled, error } = await supabase.rpc("cancel_outreach_schedule", {
    p_message_id: parsed.data.messageId,
  });
  if (error || !cancelled) {
    await reportError(error ?? new Error("Cancel matched no rows."), {
      operation: "outreach.schedule.cancel",
      messageId: parsed.data.messageId,
    });
    return { ok: false, message: "The scheduled email could not be cancelled." };
  }

  revalidatePath(`/clients/${parsed.data.organisationId}`);
  return { ok: true, message: "Scheduled send cancelled. The email is a draft again." };
}

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

  // F121: the human-review checkpoint. The gate itself runs before anything
  // else; the stage label resolves from the client's pipeline position after
  // the draft loads, so Stage 2 follow-ups are recorded as what they are.
  const { organisationId, messageId, recipient, subject, explicitlyApproved } = parsed.data;
  if (!explicitlyApproved) {
    return { ok: false, message: HUMAN_REVIEW_REQUIRED_MESSAGE };
  }
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
    .select("id, organisation_id, contact_id, send_status, sent_by_user_id, organisations(outreach_status)")
    .eq("id", messageId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (draftError || !draft) {
    if (draftError) await reportError(draftError, { operation: "outreach.send.load_draft", messageId });
    return { ok: false, message: "That draft could not be loaded. Refresh and try again." };
  }
  // F121 stage label: the pipeline position decides whether this send is a
  // Stage 1 first contact or a Stage 2 follow-up — same rule the pipeline
  // advance at the end of this action uses.
  const organisation = Array.isArray(draft.organisations) ? draft.organisations[0] : draft.organisations;
  const review = humanReviewDecision(
    organisation?.outreach_status === "not_contacted" ? "stage_one" : "stage_two",
    explicitlyApproved,
  );
  if (!review.allowed) return { ok: false, message: review.message };
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

  // F227: fixed-window per-CAM send limit, counted from the audited sent_at.
  // Fail-closed — if the count cannot be verified, nothing is sent.
  const sendLimit = resolveEmailSendLimit();
  const windowStart = new Date(Date.now() - sendLimit.windowSeconds * 1000).toISOString();
  const { count: recentSendCount, error: limitError } = await supabase
    .from("outreach_messages")
    .select("id", { count: "exact", head: true })
    .eq("sent_by_user_id", authorization.actor.id)
    .eq("send_status", "sent")
    .gte("sent_at", windowStart);
  if (limitError || recentSendCount === null) {
    if (limitError) await reportError(limitError, { operation: "outreach.send.rate_limit", messageId });
    logSecurityEvent("outreach.send_rate_limit_unavailable", {
      userId: authorization.actor.id,
      cause: limitError?.message ?? "no count returned",
    });
    return { ok: false, message: "The sending limit could not be checked. Nothing was sent." };
  }
  if (recentSendCount >= sendLimit.maximum) {
    logSecurityEvent("outreach.send_rate_limited", {
      userId: authorization.actor.id,
      windowSeconds: sendLimit.windowSeconds,
      sentInWindow: recentSendCount,
    });
    return { ok: false, message: emailLimitMessage(sendLimit.windowSeconds) };
  }

  // Save the exact reviewed content first, and REQUIRE the write to have matched:
  // `.eq(send_status)` + `.single()` turns a raced or already-sent draft into an
  // error here rather than a silent zero-row update that Gmail then makes real.
  // A failed provider call leaves an editable draft containing precisely what the
  // CAM attempted, never the earlier AI output. The reviewed recipient is saved
  // alongside (F119 AC1), so a sent row records who the email actually went to.
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

export type SaveDraftResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * F119: saves the CAM's in-progress edits without sending. Deliberately
 * lighter than sendReviewedEmail — no recipient validation, no approval, no
 * suppression check, no Gmail call — this only ever writes subject/body/
 * recipient to a still-draft row so a CAM can return to exactly what they
 * left, per F070's client profile reopening it. The recipient is persisted
 * verbatim (F119 AC1): a manually overridden address must survive the
 * save/reopen round-trip instead of being recomputed from contacts.email.
 */
export async function saveEmailDraft(input: unknown): Promise<SaveDraftResult> {
  const parsed = safeValidate(saveDraftSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      message: Object.values(parsed.fieldErrors).flat().find(Boolean) ?? "Check the draft and try again.",
    };
  }

  const authorization = await getCurrentActor("client:contact", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  const isAdmin = authorization.actor.role === "admin";

  const { organisationId, messageId, subject } = parsed.data;
  // Same reasoning as sendReviewedEmail: never trust client-side sanitization
  // alone for what actually lands in the database.
  const body = sanitizeEmailHtml(parsed.data.body);
  const recipient = parsed.data.recipient?.trim() || null;

  const supabase = await createClient();
  const { data: draft, error: draftError } = await supabase
    .from("outreach_messages")
    .select("id, send_status, sent_by_user_id")
    .eq("id", messageId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (draftError || !draft) {
    if (draftError) await reportError(draftError, { operation: "outreach.save_draft.load", messageId });
    return { ok: false, message: "That draft could not be loaded. Refresh and try again." };
  }
  if (draft.send_status !== "draft") {
    return { ok: false, message: "This email is no longer an unsent draft." };
  }
  // Same ownership rule as sending (F123 AC4): RLS lets every active user READ
  // every draft, so write access is asserted here, not left to a silent no-op.
  if (!isAdmin && draft.sent_by_user_id !== authorization.actor.id) {
    return { ok: false, message: "You can only edit drafts you generated yourself." };
  }

  // Same raced-send guard as sending: require the row to still be a draft when
  // the UPDATE lands — a concurrent send flipping the status between the load
  // check above and this write must surface as an error, not a silent zero-row
  // update that still tells the user "Draft saved."
  const { error: saveError } = await supabase
    .from("outreach_messages")
    .update({ subject, body, sent_to_email: recipient })
    .eq("id", messageId)
    .eq("organisation_id", organisationId)
    .eq("send_status", "draft")
    .select("id")
    .single();
  if (saveError) {
    // `.single()` reports a zero-row match as PGRST116, so this is where the
    // raced-send case actually lands: the draft was sent or removed between
    // the load check above and this write. Distinguish it from a transient DB
    // failure — "try again" would be a lie when the draft is simply gone.
    if ((saveError as { code?: string }).code === "PGRST116") {
      await reportError(saveError, { operation: "outreach.save_draft.write", messageId });
      return { ok: false, message: "This email is no longer an unsent draft." };
    }
    await reportError(saveError, { operation: "outreach.save_draft.write", messageId });
    return { ok: false, message: "The draft could not be saved. Try again." };
  }

  revalidatePath(`/clients/${organisationId}`);
  return { ok: true, message: "Draft saved." };
}

export type DiscardDraftResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * F120: removes an unsent draft outright. The confirmation step lives in the
 * UI (compose-button.tsx), since the content is genuinely lost once this
 * runs — this action itself does exactly one thing once called.
 *
 * Goes through the discard_outreach_draft RPC rather than a plain row delete
 * (PR #493 review): docs/audit-log-pattern.md §1 requires status-changing or
 * destructive writes to land an audit_log entry in the same transaction, and a
 * bare DELETE would leave nothing to answer "what happened to that draft?" —
 * the ai_generations cascade goes with it. The RPC (20260902130000) re-checks
 * active user + admin/ownership inside its SECURITY DEFINER body, writes the
 * outreach_email_draft_discarded audit row, then deletes — mirroring F042's
 * discard_manual_entry_draft precedent. The RLS delete policies stay enabled
 * as defense-in-depth for direct SQL.
 */
export async function discardEmailDraft(input: unknown): Promise<DiscardDraftResult> {
  const parsed = safeValidate(discardDraftSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      message: Object.values(parsed.fieldErrors).flat().find(Boolean) ?? "Check the draft and try again.",
    };
  }

  const authorization = await getCurrentActor("client:contact", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  const isAdmin = authorization.actor.role === "admin";

  const { organisationId, messageId } = parsed.data;
  const supabase = await createClient();
  const { data: draft, error: draftError } = await supabase
    .from("outreach_messages")
    .select("id, send_status, sent_by_user_id")
    .eq("id", messageId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (draftError || !draft) {
    if (draftError) await reportError(draftError, { operation: "outreach.discard_draft.load", messageId });
    return { ok: false, message: "That draft could not be loaded. Refresh and try again." };
  }
  if (draft.send_status !== "draft") {
    return { ok: false, message: "This email is no longer an unsent draft." };
  }
  // Same ownership rule as saving and sending (F123 AC4): RLS lets every
  // active user READ every draft, so write access is asserted here too.
  if (!isAdmin && draft.sent_by_user_id !== authorization.actor.id) {
    return { ok: false, message: "You can only discard drafts you generated yourself." };
  }

  const { error: rpcError } = await supabase.rpc("discard_outreach_draft", { p_message_id: messageId });
  if (rpcError) {
    await reportError(rpcError, { operation: "outreach.discard_draft.write", messageId });
    // A 42501 from the RPC means the authoritative re-check refused: raced send,
    // removed elsewhere, or lost an ownership race. Say that, not "try again" —
    // retrying can never succeed.
    if ((rpcError as { code?: string }).code === "42501") {
      return { ok: false, message: "This email is no longer an unsent draft." };
    }
    return { ok: false, message: "The draft could not be discarded. Refresh and try again." };
  }

  revalidatePath(`/clients/${organisationId}`);
  return { ok: true, message: "Draft discarded." };
}
