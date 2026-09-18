-- Fail when the anonymous database role can execute a privileged application
-- function. Run after migrations locally and against each hosted environment.
--
-- This is intentionally a database assertion rather than an HTTP probe:
-- hosted PostgREST projects may return 401 for the anonymous OpenAPI document,
-- while calling the RPC directly can execute its body before revealing whether
-- the privilege itself was correctly revoked.

do $verify_anon_function_lockout$
declare
  exposed_functions text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into exposed_functions
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'check_allowed_email_domain',
      'check_manual_entry_contact_email',
      'schedule_outreach_send',
      'suggest_organisation_edit'
    )
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if exposed_functions is not null then
    raise exception 'Anonymous role can execute private function(s): %', exposed_functions;
  end if;
end
$verify_anon_function_lockout$;
