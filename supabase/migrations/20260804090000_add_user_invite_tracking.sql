-- Migration: add_user_invite_tracking
-- Story: F008 — Invite New CAM
-- Purpose: track when a USERS row was created by an admin invite (invited_at) and
--   when the invited person accepted it (invite_accepted_at), so the admin UI can
--   tell a pending invite apart from an active account and list it separately.
--
-- Schema change approval record (SOP §7):
--   Change        | Add USERS.invited_at and USERS.invite_accepted_at, plus the
--                 | public.mark_invite_accepted() RPC.
--   Reason        | F008 AC5 — the admin's pending-invites list has to be able to
--                 | tell a pending invite apart from an active account.
--   Compatibility | Two nullable columns on an existing table; null on every
--                 | pre-existing row, which reads correctly as "never invited".
--   Data migration| None.
--   Security      | Neither column is granted to anyone (see below). The RPC
--                 | self-authorises on auth.uid() and writes audit_log.
--   Documentation | Added to Data Model tab 04 (Entities) + Data Dictionary and
--                 | exported with `npm run export:data-model` in this branch.
--                 | Approved by Bashir (Project Leader), 3 Aug 2026.
--
-- Timestamp: deliberately dated after 20260803100000, the last migration already
--   applied to staging. An earlier one would sit *behind* the remote's history and
--   `supabase db push` (which CI runs without --include-all) refuses that.
--
-- No RLS policy changes: these are extra columns on public.users, whose existing
-- users_select_active (SELECT) and users_update_self_or_admin (UPDATE) policies
-- already cover them. Neither column is added to the `update (full_name)` column
-- grant (create_users, F233), so no authenticated user — including the invited
-- person themselves — can write either column directly; both are set only by the
-- SECURITY DEFINER code below, which runs as the function owner regardless of
-- table grants.
--
-- Reversibility: paired rollback in
-- ../rollback/20260804090000_add_user_invite_tracking.down.sql

alter table public.users
  add column invited_at timestamptz,
  add column invite_accepted_at timestamptz;

comment on column public.users.invited_at is
  'When an admin invite created this row (app.handle_new_auth_user). Null for accounts that predate this column or were created directly by the seed script (F233).';
comment on column public.users.invite_accepted_at is
  'When the invited person set their first password (public.mark_invite_accepted). Null while the invite is pending. invited_at set with this null identifies a pending invite.';

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

-- Marks the invite accepted. Called from the "choose a password" Server Action
-- (src/app/reset-password/actions.ts) once the password has actually been set.
--
-- NOT a trigger on auth.users.email_confirmed_at, which is the obvious-looking
-- alternative and is wrong: verifying an invite token confirms the email and opens
-- a session *before* the person has chosen a password. Stamping there would clear
-- them out of the admin's pending-invites list at the moment they click the link
-- in their mail app — so someone who clicks, then closes the tab or loses
-- connection, would hold an account they cannot log into, invisible to the admin
-- who invited them. Accepting an invite means having a working login, and the only
-- point that is true is after the password update succeeds.
--
-- SECURITY DEFINER because invite_accepted_at is granted to nobody (see the header)
-- — the same reason set_user_role is (docs/audit-log-pattern.md §2). Authorisation
-- is auth.uid(): a caller can only ever accept their *own* pending invite, which is
-- enforced by the WHERE clause rather than a separate check.
create or replace function public.mark_invite_accepted()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_invited_at timestamptz;
begin
  if v_actor is null then
    raise exception 'mark_invite_accepted requires an authenticated session'
      using errcode = '42501';
  end if;

  update public.users
  set invite_accepted_at = now()
  where id = v_actor
    and invited_at is not null
    and invite_accepted_at is null
  returning invited_at into v_invited_at;

  -- No-op for an ordinary password reset (invited_at null) or a second call
  -- (already accepted). Not a transition, so not audited — audit-log-pattern §5.
  if v_invited_at is null then
    return;
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'invite_accepted', 'users', v_actor,
    jsonb_build_object('invited_at', v_invited_at)
  );
end;
$$;

comment on function public.mark_invite_accepted() is
  'F008: the invited person accepts their own invite by setting a first password. '
  'SECURITY DEFINER because users.invite_accepted_at is granted to no one; scoped to '
  'auth.uid() by its WHERE clause and writes an audit_log row. No-op for anyone '
  'without a pending invite, so the shared password-reset path can call it blindly.';

-- Same revoke-then-grant as set_user_role: EXECUTE defaults to public on create and
-- Supabase also default-grants it to anon, which a public revoke alone leaves behind.
revoke execute on function public.mark_invite_accepted() from public;
revoke execute on function public.mark_invite_accepted() from anon;
grant execute on function public.mark_invite_accepted() to authenticated;
