-- These SECURITY DEFINER functions are implementation details or authenticated
-- application RPCs. None is an anonymous API. PostgreSQL grants EXECUTE to
-- PUBLIC by default when a function is created, and later CREATE OR REPLACE
-- statements preserved or reintroduced anonymous access on these signatures.
-- Keep the authenticated grants already in place; remove only the anonymous
-- doors that Supabase's database advisor reports as externally callable.

revoke all on function public.check_allowed_email_domain()
  from public, anon;

revoke all on function public.check_manual_entry_contact_email()
  from public, anon;

revoke all on function public.schedule_outreach_send(uuid, timestamptz)
  from public, anon;

revoke all on function public.suggest_organisation_edit(uuid, text, text, text)
  from public, anon;
