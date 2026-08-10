-- Migration: create_resolve_data_quality_event_rpc
-- Story: F032/F260 follow-on — automated Companies House discovery + status watch.
-- Purpose: data_quality_events (20260808100000_create_data_quality_events.sql, F047)
--   has carried resolved/resolved_at/resolved_by_user_id since it was created, but no
--   RPC or UI ever used them — every needs_review/does_not_meet row it has written
--   since has sat there, visible only via direct SQL. This feature's admin review
--   queue (/admin/review) is the first UI to read this table, and needs a write path
--   to go with it. The matrix (docs/rls-permission-matrix.md §3.5) already documents
--   `DATA_QUALITY_EVENTS` UPDATE as "admin (resolve)" — this migration is what
--   actually builds that, RPC-only per the same reasoning as every other
--   resolve/acknowledge path in this project (audit-log-pattern.md).
--
-- Schema change approval record (SOP §7):
--   Change        | Add public.resolve_data_quality_event() SECURITY DEFINER RPC.
--   Reason        | Gives the admin review queue a way to act on Tier C
--                 | needs_review rows (F260) and any Charity Commission
--                 | needs_review/does_not_meet rows (F047) — both sources write this
--                 | table, neither had a resolve path.
--   Compatibility | No schema change — data_quality_events' resolved columns already
--                 | exist. Additive RPC only.
--   Data migration| None.
--   Security      | No new table, no new grant on data_quality_events itself (still
--                 | admin-only SELECT, no direct UPDATE policy). The RPC self-checks
--                 | app.is_admin() and writes audit_log in the same transaction, same
--                 | shape as acknowledge_organisation_status_flag.
--   Documentation | docs/rls-permission-matrix.md §3.5 already anticipated this row;
--                 | no further doc change needed. Approved by Bashir (Project
--                 | Leader), 9 Aug 2026.
--
-- Reversibility: paired rollback in
-- ../rollback/20260809100300_create_resolve_data_quality_event_rpc.down.sql

create or replace function public.resolve_data_quality_event(
  p_event_id uuid,
  p_note     text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_event public.data_quality_events%rowtype;
begin
  if not app.is_admin() then
    raise exception 'only an admin may resolve a data quality event'
      using errcode = '42501';
  end if;

  select * into v_event from public.data_quality_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'data quality event % not found', p_event_id using errcode = 'P0002';
  end if;

  -- Already resolved: not a transition, so not re-audited — audit-log-pattern §5.
  if v_event.resolved then
    return;
  end if;

  update public.data_quality_events
    set resolved = true, resolved_at = now(), resolved_by_user_id = v_actor
    where id = p_event_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'data_quality_event_resolved', 'raw_source_records', v_event.raw_source_record_id,
    jsonb_build_object('event_id', p_event_id, 'rule_name', v_event.rule_name, 'note', p_note)
  );
end;
$$;

comment on function public.resolve_data_quality_event(uuid, text) is
  'Admin-only: marks a data_quality_events row (F047 needs_review/does_not_meet) '
  'reviewed. SECURITY DEFINER because the table has no UPDATE policy; self-checks '
  'app.is_admin() and writes an audit_log row. No-op if already resolved.';

revoke execute on function public.resolve_data_quality_event(uuid, text) from public, anon;
grant execute on function public.resolve_data_quality_event(uuid, text) to authenticated;
