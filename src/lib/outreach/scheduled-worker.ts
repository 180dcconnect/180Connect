import { reportError } from "@/lib/error-logging";
import { sendBranchOutreach } from "@/lib/gmail/branch-sender";
import { createAdminClient } from "@/lib/supabase/admin";

type ScheduledRow = {
  id: string;
  organisation_id: string;
  subject: string;
  body: string;
  contacts: { email: string | null } | null;
  organisations: { contact_email: string | null } | null;
};

/** F126 due worker. Only messages explicitly placed in scheduled state are eligible. */
export async function sendDueReviewedEmails(now = new Date()): Promise<{ sent: number; blocked: number; failed: number }> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Scheduled outreach is not configured.");
  const { data, error } = await admin.from("outreach_messages").select("id, organisation_id, subject, body, contacts(email), organisations(contact_email)").eq("send_status", "scheduled").lte("scheduled_at", now.toISOString()).limit(50).returns<ScheduledRow[]>();
  if (error) throw error;
  const summary = { sent: 0, blocked: 0, failed: 0 };
  for (const message of data ?? []) {
    const { data: suppression, error: suppressionError } = await admin.from("suppressions").select("id").eq("organisation_id", message.organisation_id).eq("status", "active").maybeSingle();
    if (suppressionError || suppression) {
      summary.blocked += 1;
      if (suppressionError) await reportError(suppressionError, { operation: "outreach.scheduler.suppression", messageId: message.id });
      continue;
    }
    const recipient = message.contacts?.email ?? message.organisations?.contact_email;
    if (!recipient) { summary.failed += 1; continue; }
    const result = await sendBranchOutreach({ to: recipient, subject: message.subject, text: message.body });
    if (!result.ok) { summary.failed += 1; continue; }
    const sentAt = new Date().toISOString();
    const { error: updateError } = await admin.from("outreach_messages").update({ send_status: "sent", sent_at: sentAt, scheduled_at: null }).eq("id", message.id).eq("send_status", "scheduled");
    if (updateError) { summary.failed += 1; await reportError(updateError, { operation: "outreach.scheduler.record", messageId: message.id }); continue; }
    await admin.from("send_events").insert({ outreach_message_id: message.id, event_type: "sent", occurred_at: sentAt, metadata: { provider: "gmail", message_id: result.providerMessageId, thread_id: result.providerThreadId, scheduled: true } });
    summary.sent += 1;
  }
  return summary;
}
