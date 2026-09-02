-- Rollback for 20260913190000_create_link_raw_record_to_organisation_rpc.sql.

revoke execute on function public.link_raw_record_to_organisation(jsonb, uuid)
  from service_role;
drop function public.link_raw_record_to_organisation(jsonb, uuid);
