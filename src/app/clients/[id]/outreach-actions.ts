"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { canSendClientOutreach } from "@/lib/client-email-validation";
import { reportError } from "@/lib/error-logging";
import { sendBranchOutreach } from "@/lib/gmail/branch-sender";
import { checkSuppressionBeforeSend, suppressionBlockedMessage } from "@/lib/outreach/suppression-check";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nonEmptyTrimmed, safeValidate } from "@/lib/validation";

const reviewedEmailSchema = z.object({
  organisationId: z.uuid(),
  messageId: z.uuid(),
  subject: nonEmptyTrimmed(998, "Add a subject before sending."),
  body: nonEmptyTrimmed(100_000, "Add email content before sending."),
  explicitlyApproved: z.literal(true, {
    error: "Review the email and confirm approval before sending.",
  }),
});

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

  const { organisationId, messageId, subject, body, explicitlyApproved } = parsed.data;
  const supabase = await createClient();
  const { data: draft, error: draftError } = await supabase
    .from("outreach_messages")
    .select("id, organisation_id, contact_id, send_status, contacts(email), organisations(contact_email)")
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

  const suppression = await checkSuppressionBeforeSend(organisationId, async (id) => {
    const { data, error } = await supabase
      .from("suppressions")
      .select("id, reason")
      .eq("organisation_id", id)
      .eq("status", "active")
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

  const contact = Array.isArray(draft.contacts) ? draft.contacts[0] : draft.contacts;
  const organisation = Array.isArray(draft.organisations)
    ? draft.organisations[0]
    : draft.organisations;
  const decision = canSendClientOutreach(contact?.email ?? organisation?.contact_email, explicitlyApproved);
  if (!decision.allowed) return { ok: false, message: decision.warning };

  // Save the exact reviewed content first. A failed provider call leaves an editable
  // draft containing precisely what the CAM attempted, never the earlier AI output.
  const { error: saveError } = await supabase
    .from("outreach_messages")
    .update({ subject, body, sent_by_user_id: authorization.actor.id })
    .eq("id", messageId)
    .eq("send_status", "draft");
  if (saveError) {
    await reportError(saveError, { operation: "outreach.send.save_review", messageId });
    return { ok: false, message: "The reviewed email could not be saved. Nothing was sent." };
  }

  const sent = await sendBranchOutreach({ to: decision.recipient, subject, text: body });
  if (!sent.ok) return { ok: false, message: sent.reason };

  const sentAt = new Date().toISOString();
  const { error: statusError } = await supabase
    .from("outreach_messages")
    .update({ send_status: "sent", sent_at: sentAt, scheduled_at: null })
    .eq("id", messageId)
    .eq("send_status", "draft");
  if (statusError) {
    await reportError(statusError, { operation: "outreach.send.record_status", messageId });
    return { ok: false, message: "The email was sent, but its status could not be recorded. Contact an administrator." };
  }

  const admin = createAdminClient();
  if (admin) {
    const { error: eventError } = await admin.from("send_events").insert({
      outreach_message_id: messageId,
      event_type: "sent",
      occurred_at: sentAt,
      metadata: { provider: "gmail", message_id: sent.providerMessageId, thread_id: sent.providerThreadId },
    });
    if (eventError) await reportError(eventError, { operation: "outreach.send.record_event", messageId });
  }

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
