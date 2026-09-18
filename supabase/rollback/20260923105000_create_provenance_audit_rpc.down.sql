-- Rollback for 20260923105000_create_provenance_audit_rpc.sql.

revoke execute on function public.get_unprovenanced_organisations()
  from service_role;
drop function public.get_unprovenanced_organisations();
