-- Migration: last_admin_guard
-- Sequence: addition (after create_user_role_rpc, revoke_sessions_on_suspend; needs
--   public.users, app.is_admin, public.set_user_role, public.set_user_active).
-- Story: F012 (#14) Edit User Role — closes matrix §6 open gap 7.
-- Spec: docs/rls-permission-matrix.md §6 gap 7.
--
-- Schema change approval record (SOP §7):
--   Change        | Add app.guard_last_admin(uuid); set_user_role and set_user_active
--                 | each call it before a change that would remove an admin from the
--                 | active set.
--   Reason        | Gap 7: set_user_role can demote the last active admin. Each RPC's
--                 | self-change refusal keeps it safe on its own, but neither knows
--                 | about the other — two admins acting on each other concurrently
--                 | (B demotes A via set_user_role while A suspends B via
--                 | set_user_active) can jointly commit to zero active admins, which
--                 | nothing in the app can then reverse.
--   Compatibility | No table or column changes. Both RPCs keep their existing
--                 | signatures; callers are unaffected except for the new refusal
--                 | case, which only two admins racing each other can ever trigger.
--   Data migration| None.
--   Security      | app schema is not exposed to PostgREST; EXECUTE granted to nobody.
--                 | Reachable only from set_user_role / set_user_active, which run
--                 | SECURITY DEFINER and self-check is_admin() first.
--   Documentation | docs/rls-permission-matrix.md §5 (new test plan row), §6 (gap 7
--                 | marked resolved).
--                 | Pending Bashir's review (this PR).
--
-- WHY A SHARED ADVISORY LOCK. A guard added to set_user_role alone does not close
--   the gap: even if set_user_role blocks a concurrent write to the row it is about
--   to touch, set_user_active does not know any lock exists, so once unblocked it
--   proceeds using state it read before it was blocked and can still zero out
--   admins. Both RPCs have to serialize against the SAME lock for either guard to
--   mean anything. pg_advisory_xact_lock is scoped to the calling transaction and
--   releases automatically on commit or rollback — nothing to remember to release.
--
-- WHY THIS IS ONLY REACHABLE UNDER REAL CONCURRENCY, NOT A BUG IN THIS MIGRATION.
--   Any single, sequential, legitimately-authorised call to either RPC can never by
--   itself reduce the active-admin count to zero: reaching the guard means the
--   caller passed is_admin() and is not the target (self-change is already refused
--   in both functions), so the caller is themselves a surviving active admin. The
--   guard's "would this hit zero?" branch is therefore only ever reachable when a
--   second transaction is racing the first — which is exactly the case this
--   migration exists to close, and exactly why it cannot be exercised by the
--   existing pgTAP suite (single session, single transaction). Proof that the race
--   is actually closed lives in scripts/verify-last-admin-guard.mts, which opens two
--   real, concurrently-held connections.
--
-- Reversibility: paired rollback in ../rollback/20260803091819_last_admin_guard.down.sql

-- One fixed lock key, shared by both call sites below. Held until the calling
-- transaction commits or rolls back, so a concurrent call touching either RPC's
-- guarded path blocks here until the first transaction resolves, then re-reads the
-- admin count fresh rather than trusting anything read before it was blocked.
create or replace function app.guard_last_admin(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining bigint;
begin
  perform pg_advisory_xact_lock(hashtext('180connect.active_admin_guard'));

  select count(*) into v_remaining
    from public.users
   where role = 'admin' and is_active and id <> p_target_id;

  if v_remaining = 0 then
    raise exception 'this would leave the platform with no active admin'
      using errcode = '42501', hint = 'last_admin';
  end if;
end;
$$;

comment on function app.guard_last_admin(uuid) is
  'F012: refuses a change that would remove the last active admin from public.users. '
  'Takes a shared advisory lock first so a concurrent set_user_role and '
  'set_user_active call serialize against each other, not just against themselves '
  '(matrix §6 gap 7). Called only from within those two SECURITY DEFINER bodies; '
  'granted to nobody directly, same as app.revoke_sessions.';

revoke execute on function app.guard_last_admin(uuid) from public;

-- set_user_role gains one guard call, right before the update, only when the change
-- actually removes admin-ness (old role was admin, new role is not). Everything else
-- is unchanged from 20260723100100.
create or replace function public.set_user_role(
  p_user_id  uuid,
  p_new_role public.user_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_old_role public.user_role;
begin
  if not app.is_admin() then
    raise exception 'only an admin may change a user role'
      using errcode = '42501';
  end if;

  if p_user_id = v_actor then
    raise exception 'you cannot change your own role'
      using errcode = '42501';
  end if;

  select role into v_old_role from public.users where id = p_user_id;
  if v_old_role is null then
    raise exception 'user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  if v_old_role = p_new_role then
    return;
  end if;

  if v_old_role = 'admin' and p_new_role <> 'admin' then
    perform app.guard_last_admin(p_user_id);
  end if;

  update public.users set role = p_new_role where id = p_user_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'role_changed', 'users', p_user_id,
    jsonb_build_object('from', v_old_role, 'to', p_new_role)
  );
end;
$$;

comment on function public.set_user_role(uuid, public.user_role) is
  'F012: admin-only role change. SECURITY DEFINER because users.role is granted to '
  'no one; self-checks app.is_admin() and writes an audit_log row. Cannot change your '
  'own role. Refuses a demotion that would leave no active admin (matrix §6 gap 7), '
  'serialized against set_user_active via app.guard_last_admin. Accepted advisor '
  'exception — an intentional, self-authorising RPC (matrix §7).';

revoke execute on function public.set_user_role(uuid, public.user_role) from public;
revoke execute on function public.set_user_role(uuid, public.user_role) from anon;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;

-- set_user_active now also reads role (not only is_active), so it can tell whether
-- the user it is about to suspend currently counts as an active admin, and gains the
-- same guard call, only on that path. Everything else is unchanged from
-- 20260729232500.
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
  v_role       public.user_role;
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

  select role, is_active into v_role, v_was_active
    from public.users where id = p_user_id;
  if not found then
    raise exception 'user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  if v_was_active = p_is_active then
    return;
  end if;

  if v_role = 'admin' and v_was_active and not p_is_active then
    perform app.guard_last_admin(p_user_id);
  end if;

  update public.users set is_active = p_is_active where id = p_user_id;

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
  'change your own access. Suspension revokes the user''s sessions in the same '
  'transaction (app.revoke_sessions). Refuses suspending the last active admin '
  '(matrix §6 gap 7), serialized against set_user_role via app.guard_last_admin. '
  'Accepted advisor exception — an intentional, self-authorising RPC (matrix §7).';

revoke execute on function public.set_user_active(uuid, boolean) from public;
revoke execute on function public.set_user_active(uuid, boolean) from anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;
