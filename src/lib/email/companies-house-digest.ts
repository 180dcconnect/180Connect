/**
 * Admin email digest for the Companies House status-recheck job
 * (F032/F260 follow-on). Built on the existing platform-mail transport
 * (sendEmail/send.ts — Resend, console fallback when unconfigured) — this
 * module adds no new transport, only the message shape and the admin
 * recipient lookup.
 *
 * Called from the shared run function (companies-house-status-recheck.ts),
 * which runs from the weekly cron route with no session at all — recipients
 * are always resolved with the service-role admin client, never from a
 * request-scoped session.
 *
 * The discovery digest lived here too until the staged register retired the
 * discovery job; the status watch is the only scheduled Companies House job
 * left.
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
    await reportError(error, { operation: "email.companies_house_digest.load_recipients" });
    return [];
  }
  return (data ?? [])
    .map((row) => (row as { email: string }).email)
    .filter((email): email is string => Boolean(email));
}

/**
 * Sent after a status-recheck run. Skipped when nothing changed status this run.
 */
export async function sendCompaniesHouseStatusDigest(counts: {
  flagged: number;
}): Promise<void> {
  if (counts.flagged === 0) return;

  const to = await loadAdminRecipients();
  if (to.length === 0) return;

  await sendEmail({
    to,
    subject: `Companies House status watch: ${counts.flagged} organisation(s) changed status`,
    text:
      `${counts.flagged} Companies House-sourced organisation(s) changed status away ` +
      `from active this run. Review each in the admin review queue before treating ` +
      `outreach as affected — outreach_status is never changed automatically.`,
  });
}
