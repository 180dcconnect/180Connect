-- Migration: create_notification_rpcs
-- Story: F173 — In-App Notifications.
-- Purpose: the only write paths into public.notifications
--   (20260822090000_create_notifications.sql):
--
--   create_notification          producers call this; never INSERT directly
--   mark_notification_read       F177 hook — recipient marks one row read
--   mark_all_notifications_read  bell-panel "mark all" button
--   prune_notifications          retention, scheduled via pg_cron below
--
-- WHY NO AUDIT LOG ENTRIES (docs/audit-log-pattern.md §1):
--   None of these writes change ownership, status, role, or approval state of
--   a business entity — same reasoning as create_feedback
--   (20260818100000_create_feedback.sql). A notification is an ephemeral
--   signal ABOUT an event; every producer-worthy underlying event (ownership
--   assigned, status changed, reply received, ...) is already audited by the
--   RPC that caused it. Duplicating that trail here would double-record every
--   action, and auditing read-state churn would bury real transitions in noise.
--   The notifications table is its own record, and the prune job deleting old
--   rows loses nothing because the durable audit trail stays in AUDIT_LOG.
--
-- Schema change approval record (SOP §7):
--   Change         | Four public functions + one pg_cron schedule.
--   Reason         | F173 needs producer/read/prune paths without granting
--                  | INSERT/DELETE on the table to any client role.
--   Compatibility  | Additive; depends on create_notifications (same feature)
--                  | and enable_cron_extensions (pg_cron, 20260809100000).
--   Data migration | None.
--   Security       | All SECURITY DEFINER with self-checks (definer bypasses
--                  | RLS, so each function enforces its own authorisation).
--                  | prune_notifications is revoked from every interactive
--                  | role and runs only as the pg_cron job (postgres).
--   Documentation  | docs/rls-permission-matrix.md §3.19.
--
-- Reversibility: paired rollback in
-- ../rollback/20260822090100_create_notification_rpcs.down.sql

-- ---------------------------------------------------------------------------
-- Producer path
-- ---------------------------------------------------------------------------

-- Insert one notification. Returns the new row id, or null when the recipient
-- was skipped (unknown / deactivated account — producers must not have to
-- fail because a target user was offboarded mid-flow). No-op guard: returns
-- the existing row instead of duplicating when an identical undelivered
-- notification already exists (realtime bursts retry).
create or replace function public.create_notification(
  p_recipient_user_id uuid,
  p_notification_type text,
  p_title             text,
  p_body              text default null,
  p_link_path         text default null,
  p_target_table      text default null,
  p_target_id         uuid default null,
  p_actor_user_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
begin
  -- Definer bypasses RLS, so authorise explicitly: only active signed-in
  -- users (server actions run as the acting user) may produce notifications.
  -- service_role (null auth.uid()) is allowed for future system producers.
  if (select auth.uid()) is not null and not app.is_active_user() then
    raise exception 'active account required' using errcode = '42501';
  end if;

  -- Skip unknown or deactivated recipients silently.
  if not exists (
    select 1 from public.users u
    where u.id = p_recipient_user_id and u.is_active
  ) then
    return null;
  end if;

  if coalesce(trim(p_notification_type), '') = '' then
    raise exception 'notification_type is required' using errcode = '22004';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'title is required' using errcode = '22004';
  end if;
  if p_link_path is not null and p_link_path !~ '^/' then
    raise exception 'link_path must be an absolute in-app path'
      using errcode = '22023';
  end if;

  -- Idempotency window: an identical unread notification delivered in the
  -- last minute is treated as a retry, not a second event.
  select n.id into v_existing
  from public.notifications n
  where n.recipient_user_id = p_recipient_user_id
    and n.notification_type = p_notification_type
    and coalesce(n.title, '') = coalesce(p_title, '')
    and coalesce(n.link_path, '') = coalesce(p_link_path, '')
    and coalesce(n.target_table, '') = coalesce(p_target_table, '')
    and coalesce(n.target_id::text, '') = coalesce(p_target_id::text, '')
    and n.read_at is null
    and n.created_at > now() - interval '1 minute'
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.notifications (
    recipient_user_id, actor_user_id, notification_type,
    title, body, link_path, target_table, target_id
  ) values (
    p_recipient_user_id, p_actor_user_id, p_notification_type,
    p_title, p_body, p_link_path, p_target_table, p_target_id
  )
  -- actor must differ from recipient; the table check rejects self-notifications
  on conflict do nothing;

  return (
    select n.id from public.notifications n
    where n.recipient_user_id = p_recipient_user_id
      and n.notification_type = p_notification_type
      and coalesce(n.title, '') = coalesce(p_title, '')
      and coalesce(n.link_path, '') = coalesce(p_link_path, '')
      and n.read_at is null
    order by n.created_at desc
    limit 1
  );
end;
$$;

comment on function public.create_notification(uuid, text, text, text, text, text, uuid, uuid) is
  'F173: sole producer path for NOTIFICATIONS rows. Skips unknown/inactive '
  'recipients and sub-minute duplicates; never exposes table INSERT.';

revoke execute on function public.create_notification(uuid, text, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_notification(uuid, text, text, text, text, text, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read-state paths (F177 plugs into these)
-- ---------------------------------------------------------------------------

-- Mark one notification read. Returns true if this call transitioned it,
-- false if it was already read or does not exist / belongs to someone else
-- (wrong-recipient attempts are indistinguishable from misses by design —
-- no existence oracle).
create or replace function public.mark_notification_read(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_updated int;
begin
  if not app.is_active_user() then
    raise exception 'active account required' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = now()
  where id = p_id
    and recipient_user_id = v_uid
    and read_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.mark_notification_read(uuid) is
  'F173/F177: recipient-only read transition. Non-recipients get a plain '
  'false — no information leak about other users'' notifications.';

revoke execute on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- Mark every unread notification for the current user read. Returns count.
create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_updated int;
begin
  if not app.is_active_user() then
    raise exception 'active account required' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = now()
  where recipient_user_id = v_uid
    and read_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

comment on function public.mark_all_notifications_read() is
  'F173/F177: batch read transition, strictly scoped to the caller''s own rows.';

revoke execute on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Delete read notifications older than 90 days and unread ones older than a
-- year. Safe to run any time; called daily by pg_cron below under postgres,
-- so EXECUTE is deliberately granted to no interactive role.
create or replace function public.prune_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pruned int;
  v_batch  int;
begin
  delete from public.notifications
  where read_at is not null and read_at < now() - interval '90 days';

  get diagnostics v_pruned = row_count;

  delete from public.notifications
  where read_at is null and created_at < now() - interval '1 year';

  -- GET DIAGNOSTICS takes a bare diagnostic item, not an expression, so the
  -- second count lands in its own variable before being added.
  get diagnostics v_batch = row_count;
  v_pruned := v_pruned + v_batch;
  return v_pruned;
end;
$$;

comment on function public.prune_notifications() is
  'F173 retention: read > 90 days and unread > 1 year are pruned. The '
  'permanent record of underlying events remains in AUDIT_LOG.';

revoke execute on function public.prune_notifications() from public, anon, authenticated;

-- Daily at 03:30 UTC (offset from the Companies House jobs at 02:00).
select cron.schedule(
  'notifications_prune_daily',
  '30 3 * * *',
  $$ select public.prune_notifications(); $$
);
