/**
 * Column sets the inbox reads organisations and contacts with.
 *
 * Shared by /inbox (the thread list, which reads only the organisations that
 * have outreach on them) and /api/inbox/directory (Compose's full recipient
 * directory, fetched when a compose window first opens), so the rows both hand
 * to `buildRealInboxThreads` / `buildAddressableClients` can never drift apart.
 */
export const INBOX_ORG_SELECT =
  "id, legal_name, organisation_type, city, country_code, contact_email, sector, sub_sector, is_seed, outreach_status, owner_id, owner:users!organisations_owner_id_fkey(full_name, email)";

export const INBOX_CONTACT_SELECT =
  "id, organisation_id, first_name, last_name, email, job_title, phone, is_primary";
