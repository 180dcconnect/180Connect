-- Migration: create_data_quality_events
-- Story: F047 Client Criteria Check. Sequence step 7.0 (create_quality).
-- Source: Data Model tab 03 DATA_QUALITY_EVENTS.
-- Purpose: preserve distinct, queryable needs_review vs does_not_meet outcomes.
-- Reversibility: ../rollback/20260808100000_create_data_quality_events.down.sql

create type public.data_quality_rule_category as enum
  ('missing_field', 'invalid_format', 'out_of_range', 'duplicate_suspected');
create type public.data_quality_severity as enum ('warning', 'error', 'critical');

create table public.data_quality_events (
  id uuid primary key default gen_random_uuid(),
  raw_source_record_id uuid not null references public.raw_source_records (id) on delete cascade,
  rule_name text not null,
  rule_category public.data_quality_rule_category not null,
  field_name text not null,
  field_value text,
  severity public.data_quality_severity not null,
  suggested_fix text,
  auto_resolved boolean not null default false,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.users (id),
  rule_version text not null,
  created_at timestamptz not null default now(),
  constraint data_quality_resolution_consistent check (
    (resolved = false and resolved_at is null and resolved_by_user_id is null)
    or (resolved = true and resolved_at is not null)
  ),
  unique (raw_source_record_id, rule_name, rule_version)
);

create index data_quality_events_open_idx
  on public.data_quality_events (rule_name, created_at desc) where not resolved;

revoke all on public.data_quality_events from anon, authenticated;
grant select on public.data_quality_events to authenticated;
alter table public.data_quality_events enable row level security;
create policy data_quality_events_select_admin on public.data_quality_events
  for select to authenticated using (app.is_admin());

create or replace function public.record_client_criteria_outcome(
  p_raw_source_record_id uuid,
  p_outcome text,
  p_organisation_type text,
  p_reasons text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule text;
  v_severity public.data_quality_severity;
begin
  if p_outcome not in ('needs_review', 'does_not_meet') then
    raise exception 'unsupported client criteria outcome' using errcode = '22023';
  end if;
  if not exists (select 1 from public.raw_source_records where id = p_raw_source_record_id) then
    raise exception 'raw source record not found' using errcode = 'P0002';
  end if;

  v_rule := case when p_outcome = 'needs_review'
    then 'client_criteria_needs_review' else 'client_criteria_does_not_meet' end;
  v_severity := case when p_outcome = 'needs_review'
    then 'warning'::public.data_quality_severity else 'error'::public.data_quality_severity end;

  insert into public.data_quality_events (
    raw_source_record_id, rule_name, rule_category, field_name, field_value,
    severity, suggested_fix, rule_version
  ) values (
    p_raw_source_record_id, v_rule, 'out_of_range', 'organisation_type',
    p_organisation_type, v_severity, p_reasons, 'f047-v1'
  ) on conflict (raw_source_record_id, rule_name, rule_version) do update set
    field_value = excluded.field_value,
    severity = excluded.severity,
    suggested_fix = excluded.suggested_fix,
    resolved = false,
    resolved_at = null,
    resolved_by_user_id = null;

  update public.raw_source_records
    set processing_status = 'rejected', matched_organisation_id = null
    where id = p_raw_source_record_id;
end;
$$;

revoke execute on function public.record_client_criteria_outcome(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_client_criteria_outcome(uuid,text,text,text)
  to service_role;
