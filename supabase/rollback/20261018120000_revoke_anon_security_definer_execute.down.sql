-- Restore the grants that existed before the matching hardening migration.
-- This rollback deliberately reopens the advisor findings and is for emergency
-- compatibility rollback only.

grant execute on function public.check_allowed_email_domain()
  to public, anon;

grant execute on function public.check_manual_entry_contact_email()
  to public, anon;

grant execute on function public.schedule_outreach_send(uuid, timestamptz)
  to public, anon;

grant execute on function public.suggest_organisation_edit(uuid, text, text, text)
  to anon;
