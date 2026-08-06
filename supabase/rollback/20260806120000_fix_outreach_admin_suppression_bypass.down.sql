-- Rollback for 20260806120000_fix_outreach_admin_suppression_bypass.sql
--
-- WARNING: this restores a policy with a known authorisation hole. The original
-- outreach_messages_insert_admin let an admin INSERT into outreach_messages for a
-- suppressed organisation, bypassing Do-Not-Contact protection (F050) entirely.
-- Roll this back only to unblock a failed deploy, and re-apply the fix immediately
-- afterwards.

drop policy if exists outreach_messages_insert_admin on public.outreach_messages;

create policy outreach_messages_insert_admin on public.outreach_messages
  for insert to authenticated
  with check (app.is_active_user() and app.is_admin());
