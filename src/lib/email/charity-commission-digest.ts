/**
 * Admin email digest for the Charity Commission status-recheck job (F049).
 * Mirrors companies-house-digest.ts — built on the same platform-mail transport
 * (sendEmail/send.ts — Resend, console fallback when unconfigured), no new
 * transport, one message shape and the shared admin recipient lookup.
 *
 * There was a second digest here, for the weekly API discovery run. That job was
 * retired once the staged register covered it
 * (supabase/migrations/20260923120000_retire_charity_commission_discovery_cron.sql),
 * and its digest went with it rather than being left as a function nothing calls.
 * Imports are now deliberate acts on /admin/charity-commission, so they report
 * their result on screen to the person who ran them — an email telling an admin
 * what somebody else just chose to import is noise.
 *
 * Called from charity-commission-status-recheck.ts, which runs from the weekly
 * cron route with no session at all — recipients are resolved with the
 * service-role admin client, never from a request-scoped session.
 */
import { buildAdminClient } from "../supabase/admin-client-factory.ts";
import { reportError } from "../error-logging.ts";
import { sendEmail } from "./send.ts";

async function loadAdminRecipients(): Promise<string[]> {
  const supabase = buildAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("users")
    .select("email")
    .eq("role", "admin")
    .eq("is_active", true);

  if (error) {
    await reportError(error, {
      operation: "email.charity_commission_digest.load_recipients",
    });
    return [];
  }
  return (data ?? [])
    .map((row) => (row as { email: string }).email)
    .filter((email): email is string => Boolean(email));
}

/**
 * Sent after a status-recheck run. Skipped when nothing changed status this run.
 */
export async function sendCharityCommissionStatusDigest(counts: {
  flagged: number;
}): Promise<void> {
  if (counts.flagged === 0) return;

  const to = await loadAdminRecipients();
  if (to.length === 0) return;

  await sendEmail({
    to,
    subject: `Charity Commission status watch: ${counts.flagged} organisation(s) changed status`,
    text:
      `${counts.flagged} Charity Commission-sourced organisation(s) changed registration status ` +
      `away from registered this run. Review each in the admin review queue before treating ` +
      `outreach as affected — outreach_status is never changed automatically.`,
  });
}
