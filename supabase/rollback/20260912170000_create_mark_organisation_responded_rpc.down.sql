-- Reverses 20260912130000_create_mark_organisation_responded_rpc.sql.
revoke execute on function public.mark_organisation_responded(uuid) from service_role;
drop function if exists public.mark_organisation_responded(uuid);
