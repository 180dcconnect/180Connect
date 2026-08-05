-- Migration: create_user_active_rpc
-- Sequence: addition (after create_user_role_rpc; needs public.users, app.is_admin, audit_log).
-- Story: F013 (#15) Suspend User — the write-path the matrix reserves for an admin RPC.
-- Spec: docs/rls-permission-matrix.md §2.1, §3.1, §6 open question 6.
--
-- WHY AN RPC, AND WHY SECURITY DEFINER: identical reasoning to set_user_role (F012).
--   users.is_active is granted to no one (create_users: `grant update (full_name)` and
--   nothing else), so no policy or INVOKER function can write it — the change has to run
--   as the table owner. The body then re-checks app.is_admin() itself, because SECURITY
--   DEFINER bypasses the RLS that would otherwise stop a non-admin. It lives in `public`
--   so the admin UI can reach it as /rest/v1/rpc/set_user_active; that is the accepted
--   advisor exception for a self-authorising RPC (matrix §7).
--
-- ONE FLAG, NOT TWO STATES. Suspension is `is_active = false` — the same field the Data
--   Model defines as "whether the user can log in" (tab 02, users.is_active). F014
--   (Delete or Deactivate) is the same transition plus offboarding steps, not a third
--   state, so it reuses this function rather than introducing an account_status enum.
--   Decision: Bashir (Project Leader), 29 Jul 2026.
--
-- WHAT SUSPENSION DOES NOT DO: it does not touch organisations.owner_id. A suspended
--   CAM keeps their owned rows so the account can be reactivated, or reassigned by F257,
--   with the relationship intact (F013 AC3). The rows stay unclaimable in the meantime —
--   viewer_role_write_lockout only lets a CAM claim a row where owner_id is null.
--
-- Reversibility: paired rollback in ../rollback/20260729232004_create_user_active_rpc.down.sql

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
  -- Authorisation, re-checked inside the definer boundary.
  -- Every refusal carries a HINT as well as a message. PostgREST passes it through to
  -- the client as `error.hint`, which gives the route handler something stable to switch
  -- on — matching on the message text would break the UI the day someone rewords it.
  if not app.is_admin() then
    raise exception 'only an admin may change a user''s access'
      using errcode = '42501', hint = 'not_admin';
  end if;

  -- The same safety rail set_user_role carries: an admin does not suspend themselves.
  -- Self-suspension is instant self-lockout — the RLS policies would refuse the very
  -- next statement, including the one that would undo it.
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

  -- No-op changes are not audited — the trail records real transitions only.
  if v_was_active = p_is_active then
    return;
  end if;

  -- NO LAST-ACTIVE-ADMIN GUARD, AND NONE IS NEEDED HERE. Suspending the final admin
  -- would lock the organisation out of user management for good — is_active is writable
  -- by nothing but this function, so nobody would be left who could reverse it. That
  -- cannot happen through this function: reaching this line means app.is_admin() passed
  -- (the caller is an admin AND is_active) and p_user_id <> v_actor, so the caller is
  -- themselves an active admin who is not the one being suspended. At least one active
  -- admin always survives the statement. A count here would be unreachable code that
  -- reads like a safety property, which is worse than not having one.
  --
  -- The invariant is NOT airtight across functions: set_user_role (F012) can demote an
  -- admin, and two admins acting on each other concurrently — B demotes A while A
  -- suspends B — can commit to zero active admins. The guard that closes it belongs in
  -- set_user_role, not here; no lock taken on this side prevents a demotion that
  -- commits afterwards. Tracked for F012.

  update public.users set is_active = p_is_active where id = p_user_id;

  -- PRD §4.2: access changes are audited. Same transaction as the change, so the two
  -- cannot diverge. Two action names rather than one with a boolean: the audit trail is
  -- read by humans, and "who was suspended last month" should not need a jsonb filter.
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
  'Accepted advisor exception — an intentional, self-authorising RPC (matrix §7).';

-- anon can never call it; authenticated can (the body rejects non-admins). Revoke from
-- public AND anon explicitly: EXECUTE defaults to public on create, and Supabase also
-- default-grants execute to anon, which a public revoke alone does not remove.
revoke execute on function public.set_user_active(uuid, boolean) from public;
revoke execute on function public.set_user_active(uuid, boolean) from anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;
