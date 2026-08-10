/**
 * Admin email digests for the Companies House discovery and status-recheck jobs
 * (F032/F260 follow-on). Built on the existing platform-mail transport
 * (sendEmail/send.ts — Resend, console fallback when unconfigured) — this module
 * adds no new transport, only two message shapes and the admin recipient lookup.
 *
 * Called from the shared run functions (companies-house-discovery.ts,
 * companies-house-status-recheck.ts), which run from both the manual "Import"
 * button (a signed-in Server Action) and the weekly cron route (no session at
 * all) — recipients are always resolved with the service-role admin client, never
 * from a request-scoped session, so both callers behave identically.
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
 * Sent after a discovery run. Skipped entirely (not even a console-logged
 * no-op) when there's nothing to report — a weekly email that always says
 * "0 new, 0 flagged" trains admins to stop reading it.
 */
export async function sendCompaniesHouseDiscoveryDigest(counts: {
  newOrganisations: number;
  flaggedForReview: number;
}): Promise<void> {
  if (counts.newOrganisations === 0 && counts.flaggedForReview === 0) return;

  const to = await loadAdminRecipients();
  if (to.length === 0) return;

  const lines = [
    `${counts.newOrganisations} new organisation(s) added automatically from Companies House.`,
    `${counts.flaggedForReview} record(s) flagged for review — see the admin review queue.`,
  ];

  await sendEmail({
    to,
    subject: `Companies House import: ${counts.newOrganisations} added, ${counts.flaggedForReview} flagged`,
    text: lines.join("\n"),
  });
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
