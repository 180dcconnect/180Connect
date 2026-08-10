-- Migration: create_organisation_status_flags
-- Story: F032/F260 follow-on — automated Companies House discovery + status watch.
-- Purpose: when a company already in ORGANISATIONS (sourced from Companies House)
--   changes away from an 'active' company_status, record a review flag an admin can
--   see and acknowledge. Modelled directly on data_quality_events
--   (20260808100000_create_data_quality_events.sql) — same resolved/resolved_at/
--   resolved_by_user_id shape, same admin-only-SELECT-plus-RPC-only-write RLS.
--
-- WHY THIS NEVER TOUCHES ORGANISATIONS.OUTREACH_STATUS:
--   An organisation flagged here may be mid-outreach — a CAM could be actively
--   emailing a contact there. Auto-changing outreach_status the moment Companies
--   House reports a status change would silently corrupt that pipeline state out
--   from under the CAM. This table exists so a human decides what to do about a
--   status change; record_organisation_status_flag below writes nothing to
--   organisations at all, by design (confirmed with Bashir, Project Leader, 9 Aug 2026).
--
-- Schema change approval record (SOP §7):
--   Change        | Add ORGANISATION_STATUS_FLAGS table; add
--                 | record_organisation_status_flag() and
--                 | acknowledge_organisation_status_flag() SECURITY DEFINER RPCs.
--   Reason        | Companies House status-recheck job needs somewhere to surface
--                 | "this company changed status" for admin review, without writing
--                 | to organisations directly (see note above).
--   Compatibility | New table. No impact on existing streams. record_organisation_
--                 | status_flag is called only from the status-recheck job's
--                 | service-role client; acknowledge_organisation_status_flag is
--                 | admin-only.
--   Data migration| None.
--   Security      | RLS on; SELECT admin-only; no insert/update/delete policy —
--                 | writes come only through the two RPCs, each per
--                 | docs/audit-log-pattern.md (SECURITY DEFINER, self-checks
--                 | authorisation, writes audit_log in the same transaction).
--   Documentation | Data Model tab 03 (Raw Data) or 04 (Entities, as a review-flag
--                 | side table on ORGANISATIONS) — add alongside DATA_QUALITY_EVENTS.
--                 | docs/rls-permission-matrix.md gets a new §3.5 row. Approved by
--                 | Bashir (Project Leader), 9 Aug 2026.
--
-- Reversibility: paired rollback in
-- ../rollback/20260809100200_create_organisation_status_flags.down.sql

create table public.organisation_status_flags (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  company_number       text not null,
  previous_status      text not null,
  new_status           text not null,
  detected_at          timestamptz not null default now(),
  resolved             boolean not null default false,
  resolved_at          timestamptz,
  resolved_by_user_id  uuid references public.users (id),
  created_at           timestamptz not null default now(),
  constraint organisation_status_flags_resolution_consistent check (
    (resolved = false and resolved_at is null and resolved_by_user_id is null)
    or (resolved = true and resolved_at is not null)
  )
);

comment on table public.organisation_status_flags is
  'F032/F260 follow-on: a Companies House-sourced organisation whose company_status '
  'changed away from active. Never written to by anything that also touches '
  'organisations.outreach_status — see the migration header for why.';

-- One open flag per organisation at a time: a second detected drift (e.g.
-- administration -> liquidation) while the first is still unacknowledged updates
-- the existing open row (see record_organisation_status_flag's upsert) rather than
-- piling up duplicate flags for the same organisation.
create unique index organisation_status_flags_open_idx
  on public.organisation_status_flags (organisation_id) where not resolved;

revoke all on public.organisation_status_flags from anon, authenticated;
grant select on public.organisation_status_flags to authenticated;

alter table public.organisation_status_flags enable row level security;

create policy organisation_status_flags_select_admin on public.organisation_status_flags
  for select to authenticated
  using (app.is_admin());

-- No INSERT/UPDATE/DELETE policy, by the same reasoning as data_quality_events and
-- audit_log: writes come only through the two SECURITY DEFINER RPCs below, or from
-- service_role directly (which bypasses RLS regardless).

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

  -- Same transition already open and unacknowledged: nothing new for an admin to
  -- see, so neither the row nor the audit trail is touched — same no-op
  -- convention data_quality_events' record_client_criteria_outcome uses.
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

  -- Service-role action (the status-recheck job), no end user acting — actor_user_id
  -- null, same convention record_client_criteria_outcome documents.
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

comment on function public.record_organisation_status_flag(uuid, text, text, text) is
  'Companies House status-recheck job: records a review flag when a tracked '
  'company''s status drifts away from active. Never writes organisations.outreach_status. '
  'service_role only — called from the status-recheck job''s admin client, never from '
  'client code.';

revoke execute on function public.record_organisation_status_flag(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_organisation_status_flag(uuid, text, text, text)
  to service_role;

create or replace function public.acknowledge_organisation_status_flag(
  p_flag_id uuid,
  p_note    text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_flag  public.organisation_status_flags%rowtype;
begin
  if not app.is_admin() then
    raise exception 'only an admin may acknowledge a status flag'
      using errcode = '42501';
  end if;

  select * into v_flag from public.organisation_status_flags where id = p_flag_id;
  if v_flag.id is null then
    raise exception 'status flag % not found', p_flag_id using errcode = 'P0002';
  end if;

  -- Already resolved: not a transition, so not re-audited — audit-log-pattern §5.
  if v_flag.resolved then
    return;
  end if;

  update public.organisation_status_flags
    set resolved = true, resolved_at = now(), resolved_by_user_id = v_actor
    where id = p_flag_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'organisation_status_flag_acknowledged', 'organisations', v_flag.organisation_id,
    jsonb_build_object('flag_id', p_flag_id, 'note', p_note)
  );
end;
$$;

comment on function public.acknowledge_organisation_status_flag(uuid, text) is
  'Admin-only: marks a status flag reviewed. SECURITY DEFINER because '
  'organisation_status_flags has no UPDATE policy; self-checks app.is_admin() and '
  'writes an audit_log row. No-op if already resolved.';

revoke execute on function public.acknowledge_organisation_status_flag(uuid, text)
  from public, anon;
grant execute on function public.acknowledge_organisation_status_flag(uuid, text)
  to authenticated;
