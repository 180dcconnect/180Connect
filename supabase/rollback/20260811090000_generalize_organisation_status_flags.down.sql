-- Rollback for: 20260811090000_generalize_organisation_status_flags.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Only safe while every row still has source = 'companies_house' (true until a
-- Charity Commission status-recheck run writes its first flag). Rolling back after
-- that point would silently drop which source a Charity Commission-sourced flag
-- came from — check `select source, count(*) from organisation_status_flags group
-- by source` first.

drop function if exists public.record_organisation_status_flag(uuid, text, text, text, text);

create or replace function public.record_organisation_status_flag(
  p_organisation_id uuid,
  p_company_number  text,
  p_previous_status text,
  p_new_status      text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.organisation_status_flags%rowtype;
  v_is_noop  boolean;
begin
  if not exists (select 1 from public.organisations where id = p_organisation_id) then
    raise exception 'organisation not found' using errcode = 'P0002';
  end if;

  select * into v_existing
    from public.organisation_status_flags
   where organisation_id = p_organisation_id
     and not resolved;

  v_is_noop := v_existing.id is not null
    and v_existing.previous_status = p_previous_status
    and v_existing.new_status = p_new_status;

  if v_is_noop then
    return;
  end if;

  insert into public.organisation_status_flags (
    organisation_id, company_number, previous_status, new_status
  ) values (
    p_organisation_id, p_company_number, p_previous_status, p_new_status
  )
  on conflict (organisation_id) where not resolved do update set
    company_number = excluded.company_number,
    new_status = excluded.new_status,
    detected_at = now();

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null, 'organisation_status_flagged', 'organisations', p_organisation_id,
    jsonb_build_object(
      'company_number', p_company_number,
      'from', p_previous_status,
      'to', p_new_status
    )
  );
end;
$$;

revoke execute on function public.record_organisation_status_flag(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_organisation_status_flag(uuid, text, text, text)
  to service_role;

alter table public.organisation_status_flags
  drop constraint if exists organisation_status_flags_source_check;

alter table public.organisation_status_flags
  drop column if exists source;
