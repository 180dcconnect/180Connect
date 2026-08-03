-- Migration: add_user_invite_tracking
-- Story: F008 — Invite New CAM
-- Purpose: track when a USERS row was created by an admin invite (invited_at) and
--   when the invited person accepted it (invite_accepted_at), so the admin UI can
--   tell a pending invite apart from an active account and list it separately.
--
-- Data Model: docs/data-model/04-entities.md and 02-data-dictionary.md are
--   generated from the Data Model spreadsheet (npm run export:data-model) and
--   cannot be hand-edited here. USERS.invited_at and USERS.invite_accepted_at
--   must be added to that spreadsheet by its owner before/alongside this
--   migration landing, per SOP §7 — flagged in the PR, not done in this commit.
--
-- No RLS policy changes: these are extra columns on public.users, whose existing
-- users_select_active (SELECT) and users_update_self_or_admin (UPDATE) policies
-- already cover them. Neither column is added to the `update (full_name)` column
-- grant (create_users, F233), so no authenticated user — including the invited
-- person themselves — can write either column directly; both are set only by the
-- SECURITY DEFINER triggers below, which run as the function owner regardless of
-- table grants.
--
-- Reversibility: paired rollback in
-- ../rollback/20260731090000_add_user_invite_tracking.down.sql

alter table public.users
  add column invited_at timestamptz,
  add column invite_accepted_at timestamptz;

comment on column public.users.invited_at is
  'When an admin invite created this row (app.handle_new_auth_user). Null for accounts that predate this column or were created directly by the seed script (F233).';
comment on column public.users.invite_accepted_at is
  'When the invited person first confirmed their email (app.handle_auth_user_confirmed). Null while the invite is pending. invited_at set with this null identifies a pending invite.';

-- Extends the existing auth-trigger mirror (create_users, F233) to also record who
-- sent the invite and when. inviteUserByEmail's `data` option (see
-- src/lib/auth/invite.ts) lands in raw_user_meta_data, which is the only way this
-- trigger — firing on auth.users, not on any application request — can learn who
-- the inviting admin was. A row created any other way (seed script, the first
-- bootstrapped admin) carries no such metadata, so invited_at stays null for it —
-- deliberately: it was never a pending invite and must not show as one.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, invited_by_user_id, invited_at)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'invited_by_user_id', '')::uuid,
    case when new.raw_user_meta_data ? 'invited_by_user_id' then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Marks an invite accepted the moment the invited person confirms their email —
-- the same instant verifyOtp({type: 'invite'}) succeeds against the link Supabase
-- emailed them (src/app/auth/confirm/route.ts). SECURITY DEFINER for the same
-- reason as handle_new_auth_user: it runs inside auth.users' own update, which has
-- no grant on public.users.
create or replace function app.handle_auth_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users
  set invite_accepted_at = now()
  where id = new.id and invite_accepted_at is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function app.handle_auth_user_confirmed();
