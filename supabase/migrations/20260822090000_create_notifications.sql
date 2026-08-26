-- Migration: create_notifications
-- Story: F173 — In-App Notifications.
-- Purpose: core notification storage layer. One NOTIFICATIONS row per event a
--   specific user should see in their bell panel. This is deliberately a
--   general mechanism (issue #169 AC1): notification_type is an open token so
--   future producers (replies, reminders, team activity, ownership changes)
--   plug in without further schema change. Read state (read_at) ships now so
--   F177 Notification Read Status (#173) needs no second migration.
--
-- WHY NO AUDIT LOG ENTRIES HERE:
--   The table carries no client-facing INSERT grant — rows are only written
--   through public.create_notification (20260822090100). None of the
--   notification write paths change ownership, status, role or approval state,
--   so none of them write AUDIT_LOG rows (docs/audit-log-pattern.md §1, same
--   reasoning as create_feedback). Full rationale in the RPCs migration's
--   header; the durable trail of the underlying events stays in AUDIT_LOG.
--
-- RETENTION:
--   Notifications are ephemeral UI signals, not records — the durable trail of
--   every underlying event lives in AUDIT_LOG forever. A daily pg_cron prune
--   (same RPCs migration) deletes read rows older than 90 days and unread rows
--   older than 1 year.
--
-- REALTIME:
--   Added to supabase_realtime so the bell panel can subscribe to its own rows
--   without polling (issue #169 AC2). postgres_changes delivery is filtered by
--   the SELECT policy below per subscriber, exactly as documented in
--   widen_audit_log_for_client_timeline (20260820110000) — adding to the
--   publication does not bypass row security.
--
-- Schema change approval record (SOP §7):
--   Change         | New table public.NOTIFICATIONS (+ policies, indexes,
--                  | realtime publication membership).
--   Reason         | F173 in-app notifications need persistent per-user
--                  | storage that survives sessions (AC3).
--   Compatibility  | Additive only; no existing table, policy or query touched.
--   Data migration | None.
--   Security       | RLS: recipients read/update only their own rows;
--                  | anon granted nothing; no INSERT/DELETE grant for anyone —
--                  | writes go through SECURITY DEFINER RPCs that self-check.
--   Documentation  | Data Model tab 04 Entities + tab 02 Data Dictionary +
--                  | tab 11 sequence step; docs/rls-permission-matrix.md §3.19.
--
-- Reversibility: paired rollback in
-- ../rollback/20260822090000_create_notifications.down.sql

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.users (id),
  actor_user_id     uuid references public.users (id),
  notification_type text not null,
  title             text not null,
  body              text,
  link_path         text,
  target_table      text,
  target_id         uuid,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  constraint notifications_actor_not_recipient
    check (actor_user_id is null or actor_user_id <> recipient_user_id),
  constraint notifications_link_path_absolute
    check (link_path is null or link_path like '/%')
);

comment on table public.notifications is
  'F173: per-user in-app notification feed. Ephemeral signal layer over '
  'AUDIT_LOG-style events; pruned by cron (read > 90 days, unread > 1 year).';

create index notifications_recipient_recent
  on public.notifications (recipient_user_id, created_at desc);

create index notifications_recipient_unread
  on public.notifications (recipient_user_id, created_at desc)
  where read_at is null;

-- 1. Revoke before granting (MIGRATIONS.md §RLS skeleton step 1). No INSERT or
--    DELETE grant at all: creation goes through create_notification, deletion
--    through the cron prune — clients never write rows directly.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- 2. RLS on
alter table public.notifications enable row level security;

-- 3. Policies to authenticated, built from helpers, gated on is_active.
-- Wrong-recipient prevention (issue testing note): a user can only ever see
-- and touch rows addressed to them, and only while active.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (
    app.is_active_user()
    and recipient_user_id = (select auth.uid())
  );

create policy notifications_update_own_read_state on public.notifications
  for update to authenticated
  using (
    app.is_active_user()
    and recipient_user_id = (select auth.uid())
  )
  with check (
    app.is_active_user()
    and recipient_user_id = (select auth.uid())
  );

-- The column grant above already restricts updates to read_at; this trigger
-- guard makes that airtight even against SECURITY DEFINER callers that forget
-- themselves, and keeps read_at monotonic (null -> timestamp, never back).
create function public.guard_notification_read_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recipient_user_id is distinct from old.recipient_user_id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.notification_type is distinct from old.notification_type
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.link_path is distinct from old.link_path
     or new.target_table is distinct from old.target_table
     or new.target_id is distinct from old.target_id
     or new.created_at is distinct from old.created_at then
    raise exception 'only read_at may be changed on a notification'
      using errcode = '42501';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'a read notification cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_notification_read_state() from public, anon;
create trigger guard_notification_read_state
  before update on public.notifications
  for each row execute function public.guard_notification_read_state();

-- AC2: live delivery. Publication membership alone grants nothing — the SELECT
-- policy above still filters what each subscriber receives.
alter publication supabase_realtime add table public.notifications;
