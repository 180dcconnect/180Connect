-- Migration: create_inbox_thread_state
-- Story: /inbox — per-viewer thread state (star, read/unread, trash).
-- Purpose: give the mailbox's three per-viewer controls somewhere to live.
--   Until now they had nowhere: buildRealInboxThreads had to hand every
--   thread `isStarred: false` and derive `isRead` from whether the newest
--   event was an unanswered reply, and the shell held every change in React
--   state alone -- so starring a thread, marking it read, or trashing it
--   lasted until the next navigation and then silently undid itself. The
--   interim fix put them in the browser's localStorage
--   (src/lib/inbox/thread-flags.ts), which is the right SHAPE (these are
--   per-viewer facts) but the wrong REACH: they do not follow a CAM to
--   another device and no server-side feature can read them.
--
-- ONE ROW PER (USER, THREAD), AND A THREAD IS AN ORGANISATION.
--   OUTREACH_MESSAGES stores no gmail_thread_id, so the mailbox defines a
--   thread as one organisation's entire outreach history -- which is why
--   `?thread=<organisationId>` is a valid deep link app-wide. The FK is
--   therefore to ORGANISATIONS, not to a message or a thread table, and the
--   unique constraint on (user_id, organisation_id) is what makes the app's
--   upsert-on-toggle safe under two tabs.
--
-- WHY read_state IS THREE-VALUED AND NOT A BOOLEAN.
--   Both directions are deliberate overrides of a value the server derives.
--   A thread the server calls unread (an unanswered reply) that the CAM has
--   read must stay read; one they marked unread on purpose must not be
--   flipped back by that same derivation on the next page load. NULL means
--   "no opinion -- use whatever the server derived", which is also what
--   makes the prune below able to delete a row that has drifted back to
--   meaning nothing.
--
-- TRASH IS CAPPED, DELIBERATELY (Bashir, Project Leader, 8 Sep 2026).
--   The database ceiling is 500 MB, so nothing here is allowed to grow
--   without a bound. Two limits, both enforced in the database rather than
--   in application code, because a cap that only the app honours is not a
--   cap:
--     1. At most 200 trashed threads per user at any time. The trigger
--        below untrashes the oldest beyond that on every new trashing, so
--        the newest 200 are always the ones kept -- the same behaviour as a
--        desk tray that tips at the back.
--     2. A trashed thread is purged after 30 days by the daily job in
--        20260924090100_schedule_inbox_thread_state_prune.sql, matching the
--        30 days Gmail keeps its own trash.
--   Sizing, for the record: a row is ~112 bytes plus ~90 bytes across its
--   two indexes, so ~200 bytes all-in. The trash cap therefore bounds trash
--   at 200 rows x 200 bytes = ~40 KB per user. Stars and read overrides are
--   naturally bounded by how many threads a CAM actually touches; at 5,000
--   per user that is ~1 MB each. This table cannot meaningfully consume the
--   500 MB budget.
--
-- NOTHING HERE IS AUDITED, ON PURPOSE.
--   docs/audit-log-pattern.md requires an audit entry for writes that change
--   ownership, status, role or approval state. Starring a thread changes
--   none of them -- it changes one person's view of their own mailbox, and
--   is invisible to everyone else. Same documented reasoning as `feedback`
--   and `notifications` (matrix 3.19).
--
-- Schema change approval record (SOP §7):
--   Change        | New table INBOX_THREAD_STATE + enum inbox_read_state,
--                 | one BEFORE INSERT OR UPDATE trigger enforcing the trash
--                 | cap, and public.prune_inbox_thread_state() for the
--                 | paired cron migration to call.
--   Reason        | The mailbox's star / read / trash controls have no
--                 | storage, so every use of them is undone by the next
--                 | navigation.
--   Compatibility | Additive. No existing table, column, grant or policy is
--                 | touched. The app reads this through a store that
--                 | currently falls back to localStorage, so a deployment
--                 | with the table absent still works.
--   Data migration| None. Existing localStorage flags are not migrated --
--                 | they are per-browser and unreachable from the server.
--   Security      | RLS on, own-row only for all four verbs, every policy
--                 | gated on app.is_active_user(). No admin read: this is
--                 | one person's view of their own mailbox and there is no
--                 | operational reason for anyone else to see it.
--   Documentation | docs/rls-permission-matrix.md 3.20; Data Model tab
--                 | "INBOX_THREAD_STATE" + tab 02 Data Dictionary + tab 11
--                 | migration sequence.
--
-- Reversibility: paired rollback in
--   supabase/rollback/20260924090000_create_inbox_thread_state.down.sql

create type public.inbox_read_state as enum ('read', 'unread');

create table public.inbox_thread_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  is_starred boolean not null default false,
  -- NULL = no opinion; the server's own derivation stands. See the header.
  read_state public.inbox_read_state,
  is_trashed boolean not null default false,
  -- When it was trashed, which is what both the cap and the 30-day purge
  -- order by. Kept in step with is_trashed by the trigger below rather than
  -- trusted from the client, so a client cannot backdate its way past the
  -- cap or forward-date its way out of the purge.
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per person per thread. This is what makes the app's
  -- upsert-on-toggle safe when the same mailbox is open in two tabs.
  constraint inbox_thread_state_user_thread_unique unique (user_id, organisation_id),
  -- trashed_at is set if and only if the row is trashed.
  constraint inbox_thread_state_trashed_at_matches
    check ((is_trashed and trashed_at is not null) or (not is_trashed and trashed_at is null))
);

comment on table public.inbox_thread_state is
  'Per-viewer state for one mailbox thread (one organisation). Star, read/unread override and trash. Own-row only; never shared, never audited.';
comment on column public.inbox_thread_state.read_state is
  'Override of the server-derived read flag. NULL means no override.';
comment on column public.inbox_thread_state.trashed_at is
  'Set by trigger, not by the client. Orders both the 200-row per-user cap and the 30-day purge.';

-- Every query this table serves is "my rows", and the prune walks trashed
-- rows oldest-first. The unique constraint already indexes (user_id, ...),
-- so only the prune's access path needs one of its own. Partial, because
-- only trashed rows are ever scanned this way.
create index inbox_thread_state_trashed_idx
  on public.inbox_thread_state (trashed_at)
  where is_trashed;

create trigger inbox_thread_state_set_updated_at
  before update on public.inbox_thread_state
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Trash: stamp the time, and hold the per-user cap.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_inbox_trash_cap()
returns trigger
language plpgsql
-- Pinned, so the function cannot be redirected by a caller's search_path.
set search_path = public
as $$
declare
  -- Per-user ceiling on trashed threads. See the migration header: this is a
  -- deliberate bound on a 500 MB database, not a guess at what a CAM needs.
  cap constant integer := 200;
begin
  -- trashed_at is derived here so the client never supplies it. A client that
  -- could set it could either backdate a row to dodge the cap's ordering or
  -- forward-date one to outlive the 30-day purge.
  if new.is_trashed and not coalesce(old.is_trashed, false) then
    -- clock_timestamp(), NOT now(). now() is the TRANSACTION's start time, so
    -- a bulk trashing -- which the mailbox has, as "delete selected" -- would
    -- stamp every row in the batch identically and leave the cap's
    -- oldest-first ordering with nothing to sort by. Measured: trashing 250
    -- threads in one statement kept 200, but evicted an arbitrary 50 rather
    -- than the 50 oldest. clock_timestamp() advances within the statement.
    new.trashed_at := clock_timestamp();
  elsif not new.is_trashed then
    new.trashed_at := null;
  else
    new.trashed_at := old.trashed_at;
  end if;

  -- Oldest-out, so the newest `cap` trashings are the ones kept. Untrashed
  -- rather than deleted: the row may still carry a star or a read override,
  -- and the prune below is what eventually removes one that carries nothing.
  if new.is_trashed then
    update public.inbox_thread_state
       set is_trashed = false,
           trashed_at = null
     where user_id = new.user_id
       and is_trashed
       and id <> new.id
       and id in (
         select id
           from public.inbox_thread_state
          where user_id = new.user_id
            and is_trashed
            and id <> new.id
          -- id is the tiebreaker, so the order is total even if two rows
          -- somehow share a clock reading. Without it the ordering is
          -- unspecified on a tie and the eviction picks arbitrarily.
          order by trashed_at desc, id desc
         offset cap - 1
       );
  end if;

  return new;
end;
$$;

comment on function public.enforce_inbox_trash_cap() is
  'Stamps trashed_at and holds each user to 200 trashed threads, oldest out.';

create trigger inbox_thread_state_trash_cap
  before insert or update on public.inbox_thread_state
  for each row execute function public.enforce_inbox_trash_cap();

-- ---------------------------------------------------------------------------
-- Prune. Called by the daily cron job in the paired migration.
-- ---------------------------------------------------------------------------

create or replace function public.prune_inbox_thread_state()
returns integer
language sql
security definer
set search_path = public
as $$
  with purged as (
    delete from public.inbox_thread_state
     where
       -- Trash older than 30 days, the same window Gmail keeps its own.
       (is_trashed and trashed_at < now() - interval '30 days')
       -- Or a row that has drifted back to meaning nothing: unstarred, no
       -- read override, not trashed. Keeping it would say the same thing as
       -- having no row at all, at 200 bytes a time.
       or (not is_starred and read_state is null and not is_trashed)
    returning 1
  )
  select count(*)::integer from purged;
$$;

comment on function public.prune_inbox_thread_state() is
  'Deletes trash older than 30 days and rows that no longer carry any state. Returns rows deleted.';

-- Granted to nobody interactive: this runs as its cron job and nothing else.
revoke all on function public.prune_inbox_thread_state() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Security (SOP §7 — RLS in the same migration as the table).
-- ---------------------------------------------------------------------------

-- 1. Revoke Supabase's default grants first, then grant back only the verbs
--    the matrix allows. A policy alone would leave every column writable.
revoke all on public.inbox_thread_state from anon, authenticated;
grant select, insert, update, delete on public.inbox_thread_state to authenticated;

-- 2. RLS on.
alter table public.inbox_thread_state enable row level security;

-- 3. Own-row only, for every verb, gated on the user still being active.
--    `app.is_active_user()` is wrapped in (select ...) so it is evaluated once
--    per statement rather than once per row; `auth.uid()` likewise. There is
--    deliberately no admin branch on any of these four -- an admin has no
--    reason to read, still less to change, which threads another CAM has
--    starred in their own mailbox.
create policy inbox_thread_state_select_own on public.inbox_thread_state
  for select to authenticated
  using ((select app.is_active_user()) and user_id = (select auth.uid()));

create policy inbox_thread_state_insert_own on public.inbox_thread_state
  for insert to authenticated
  with check ((select app.is_active_user()) and user_id = (select auth.uid()));

create policy inbox_thread_state_update_own on public.inbox_thread_state
  for update to authenticated
  using ((select app.is_active_user()) and user_id = (select auth.uid()))
  with check ((select app.is_active_user()) and user_id = (select auth.uid()));

create policy inbox_thread_state_delete_own on public.inbox_thread_state
  for delete to authenticated
  using ((select app.is_active_user()) and user_id = (select auth.uid()));
