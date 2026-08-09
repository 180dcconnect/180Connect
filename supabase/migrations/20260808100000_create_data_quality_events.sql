-- Migration: create_data_quality_events
-- Story: F047 Client Criteria Check. Sequence step 7.0 (create_quality).
-- Source: Data Model tab 03 DATA_QUALITY_EVENTS.
-- Purpose: preserve distinct, queryable needs_review vs does_not_meet outcomes.
-- Spec: docs/client-criteria.md; docs/audit-log-pattern.md
--
-- Schema change approval record (SOP §7):
--   Change        | Add DATA_QUALITY_EVENTS table; add
--                 | record_client_criteria_outcome() SECURITY DEFINER RPC.
--   Reason        | F047 AC1 (every incoming record checked against target-client
--                 | criteria), AC2 (a failing record is excluded or flagged for
--                 | review, not silently dropped).
--   Compatibility | New table. No impact on existing streams. Writers are the RPC
--                 | (SECURITY DEFINER) and service_role only.
--   Data migration| None.
--   Security      | RLS on; SELECT admin-only; no insert/update/delete policy —
--                 | writes come only through the RPC. RPC excludes the record from
--                 | the active client list and, per docs/audit-log-pattern.md,
--                 | inserts an audit_log row in the same transaction. EXECUTE
--                 | revoked from public/anon/authenticated, granted to service_role
--                 | only (called from the import pipeline, not client code).
--   Documentation | Data Model tab 03 DATA_QUALITY_EVENTS. docs/client-criteria.md.
--                 | Approved by Bashir (Project Leader), 9 Aug 2026.
--
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
  p_reasons text,
  p_priority text default null,
  p_healthcare_aligned boolean default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule text;
  v_other_rule text;
  v_version text := 'f047-v1';
  v_severity public.data_quality_severity;
  v_existing public.data_quality_events%rowtype;
  v_is_noop boolean;
begin
  if p_outcome not in ('needs_review', 'does_not_meet') then
    raise exception 'unsupported client criteria outcome' using errcode = '22023';
  end if;
  if not exists (select 1 from public.raw_source_records where id = p_raw_source_record_id) then
    raise exception 'raw source record not found' using errcode = 'P0002';
  end if;

  v_rule := case when p_outcome = 'needs_review'
    then 'client_criteria_needs_review' else 'client_criteria_does_not_meet' end;
  v_other_rule := case when p_outcome = 'needs_review'
    then 'client_criteria_does_not_meet' else 'client_criteria_needs_review' end;
  v_severity := case when p_outcome = 'needs_review'
    then 'warning'::public.data_quality_severity else 'error'::public.data_quality_severity end;

  -- A re-evaluation can flip outcome (needs_review <-> does_not_meet). rule_name
  -- differs between the two, so that flip lands under a different conflict target
  -- below and would otherwise leave the old outcome's row open and unresolved
  -- forever. Close it out as superseded rather than losing track of it.
  update public.data_quality_events
     set resolved = true, resolved_at = now()
   where raw_source_record_id = p_raw_source_record_id
     and rule_name = v_other_rule
     and rule_version = v_version
     and not resolved;

  select * into v_existing
    from public.data_quality_events
   where raw_source_record_id = p_raw_source_record_id
     and rule_name = v_rule
     and rule_version = v_version;

  v_is_noop := v_existing.id is not null
    and v_existing.field_value is not distinct from p_organisation_type
    and v_existing.suggested_fix is not distinct from p_reasons;

  -- Same outcome, same reasons as last time: a genuine no-op, so an admin's prior
  -- review of this exact issue is left untouched — same convention
  -- set_outreach_status/claim_organisation use for skipping the audit insert on a
  -- no-op (docs/audit-log-pattern.md §5).
  if not v_is_noop then
    insert into public.data_quality_events (
      raw_source_record_id, rule_name, rule_category, field_name, field_value,
      severity, suggested_fix, rule_version
    ) values (
      p_raw_source_record_id, v_rule, 'out_of_range', 'organisation_type',
      p_organisation_type, v_severity, p_reasons, v_version
    ) on conflict (raw_source_record_id, rule_name, rule_version) do update set
      field_value = excluded.field_value,
      severity = excluded.severity,
      suggested_fix = excluded.suggested_fix,
      resolved = false,
      resolved_at = null,
      resolved_by_user_id = null;

    -- No end user is acting here — this runs from the server-side import
    -- pipeline (service_role), so actor_user_id is null (system action), same
    -- convention audit_log.actor_user_id documents for service-role writes.
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      null, 'client_criteria_rejected', 'raw_source_records', p_raw_source_record_id,
      jsonb_build_object(
        'outcome', p_outcome,
        'organisation_type', p_organisation_type,
        'reasons', p_reasons,
        'priority', p_priority,
        'healthcare_aligned', p_healthcare_aligned
      )
    );
  end if;

  update public.raw_source_records
    set processing_status = 'rejected', matched_organisation_id = null
    where id = p_raw_source_record_id;
end;
$$;

revoke execute on function public.record_client_criteria_outcome(uuid,text,text,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.record_client_criteria_outcome(uuid,text,text,text,text,boolean)
  to service_role;
