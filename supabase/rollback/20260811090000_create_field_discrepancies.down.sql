-- Rollback: create_field_discrepancies

drop function if exists public.resolve_field_discrepancy(uuid, text, text);
drop function if exists public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid);

drop table if exists public.field_discrepancies;
