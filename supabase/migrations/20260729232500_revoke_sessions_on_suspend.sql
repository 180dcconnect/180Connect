-- Migration: revoke_sessions_on_suspend
-- Sequence: addition (immediately after create_user_active_rpc; needs public.users,
--   app.is_admin, public.set_user_active).
-- Story: F013 (#15) Suspend User — AC2, "sessions invalidated".
-- Spec: docs/rls-permission-matrix.md §6 open question 8.
--
-- Schema change approval record (SOP §7):
--   Change        | Add app.revoke_sessions(uuid); set_user_active calls it on suspend.
--   Reason        | The application-side sweep it replaces never worked (below), so
--                 | F013 AC2 was not actually met by the code that claimed it.
--   Compatibility | No table or column changes. Deletes rows from auth.sessions, which
--                 | is what signing a user out does anyway.
--   Data migration| None.
--   Security      | app schema is not exposed to PostgREST; EXECUTE granted to nobody.
--                 | Reachable only from set_user_active, which self-checks is_admin().
--   Documentation | docs/rls-permission-matrix.md §3.1 and §6.
--                 | Approved by Bashir (Project Leader), 30 Jul 2026.
--
-- WHY THIS EXISTS. `src/lib/supabase/admin.ts` called
--   `auth.admin.signOut(userId, 'global')`, but that method's first parameter is a
--   **JWT**, not a user id — auth-js forwards it as the bearer token on POST /logout.
--   GoTrue therefore answered `invalid JWT: unable to parse or verify signature, token
--   is malformed: token contains an invalid number of segments` on every single call,
--   so no suspension has ever revoked a session; each one silently took the failure
--   branch and showed the admin a warning. Observed against a local stack, 30 Jul 2026.
--
--   It is not a parameter fix. GoTrue v2.193.1 exposes no by-user-id logout endpoint at
--   all: /admin/users/{id}/logout and /admin/users/{id}/sessions both 404. Revoking
--   someone else's sessions is only reachable through the database.
--
-- WHY DELETING auth.sessions IS THE RIGHT MECHANISM, measured rather than assumed
--   (local stack, 30 Jul 2026, GoTrue v2.193.1). With the row deleted:
--     - GET /auth/v1/user with the still-unexpired access token: 200 -> 403;
--     - POST /token?grant_type=refresh_token: 400;
--     - auth.refresh_tokens for that user: cascade-deleted, 0 rows left.
--   That is a genuine global sign-out, which is what AC2 asks for.
--
-- PRIVILEGE. auth.sessions is owned by supabase_auth_admin, not by us. This function is
--   SECURITY DEFINER and owned by `postgres`, which holds DELETE on that table —
--   verified on 180connect-staging on 30 Jul 2026 (`has_table_privilege('postgres',
--   'auth.sessions','delete')` is true; `postgres` is not a superuser, so the privilege
--   is a real grant and not an artefact of local development).
--
-- NO EXCEPTION HANDLER, DELIBERATELY. The delete runs in the same transaction as the
--   flag flip, so a suspension either fully lands or does not happen. The only
--   plausible failure is that privilege being withdrawn, which is a deployment fault
--   and must be loud rather than degrade into the silent half-suspension this migration
--   exists to remove. A failed suspension is not an open door either way: is_active is
--   unchanged in that case, and every RLS policy already gates on app.is_active_user().
--
-- Reversibility: paired rollback in ../rollback/20260729232500_revoke_sessions_on_suspend.down.sql

create or replace function app.revoke_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function app.revoke_sessions(uuid) is
  'F013: deletes every session belonging to a user, which invalidates their access '
  'token and their refresh token at once. Lives in app (not exposed to PostgREST) and '
  'is granted to nobody: it is called only from set_user_active / deactivate_user, '
  'which run SECURITY DEFINER as the owner and self-check app.is_admin() first.';

-- EXECUTE to nobody. Its callers are SECURITY DEFINER functions running as the owner,
-- so they need no grant; anything else must not reach a function that can sign an
-- arbitrary user out. `public` is revoked explicitly because EXECUTE defaults to it.
revoke execute on function app.revoke_sessions(uuid) from public;

-- set_user_active gains one line. Everything else is unchanged from
-- 20260729232004 — see that migration for the reasoning behind each guard.
create or replace function public.set_user_active(
  p_user_id   uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_was_active boolean;
begin
  if not app.is_admin() then
    raise exception 'only an admin may change a user''s access'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if p_user_id = v_actor then
    raise exception 'you cannot change your own access'
      using errcode = '42501', hint = 'self_access_change';
  end if;

  select is_active into v_was_active
    from public.users where id = p_user_id;
  if not found then
    raise exception 'user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  if v_was_active = p_is_active then
    return;
  end if;

  update public.users set is_active = p_is_active where id = p_user_id;

  -- Suspension signs them out for real. Reactivation deliberately does not touch
  -- sessions: there are none to revoke, and the user signs in again normally.
  if not p_is_active then
    perform app.revoke_sessions(p_user_id);
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_is_active then 'user_reactivated' else 'user_suspended' end,
    'users', p_user_id,
    jsonb_build_object('from', v_was_active, 'to', p_is_active)
  );
end;
$$;

comment on function public.set_user_active(uuid, boolean) is
  'F013: admin-only suspend/reactivate. SECURITY DEFINER because users.is_active is '
  'granted to no one; self-checks app.is_admin() and writes an audit_log row. Cannot '
  'change your own access, which is also what keeps at least one active admin alive. '
  'Suspension revokes the user''s sessions in the same transaction (app.revoke_sessions), '
  'so the change binds on their existing token and not only in the database. '
  'Accepted advisor exception — an intentional, self-authorising RPC (matrix §7).';
