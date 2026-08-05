-- Migration: last_admin_guard
-- Sequence: addition (after create_deactivate_user_rpc; needs public.users,
--   app.is_admin, public.set_user_role, public.set_user_active,
--   public.deactivate_user).
-- Story: F012 (#14) Edit User Role — closes matrix §6 open gap 7.
-- Spec: docs/rls-permission-matrix.md §6 gap 7.
--
-- Schema change approval record (SOP §7):
--   Change        | Add app.guard_last_admin(uuid); set_user_role, set_user_active and
--                 | deactivate_user each call it before a change that would remove an
--                 | admin from the active set.
--   Reason        | Gap 7: set_user_role can demote the last active admin. Each RPC's
--                 | self-change refusal keeps it safe on its own, but none of them know
--                 | about the others — two admins acting on each other concurrently
--                 | (B demotes A via set_user_role while A suspends B via
--                 | set_user_active, or deactivates them via deactivate_user) can
--                 | jointly commit to zero active admins, which nothing in the app can
--                 | then reverse.
--   Compatibility | No table or column changes. All three RPCs keep their existing
--                 | signatures; callers are unaffected except for the new refusal
--                 | case, which only two admins racing each other can ever trigger.
--   Data migration| None.
--   Security      | app schema is not exposed to PostgREST; EXECUTE granted to nobody.
--                 | Reachable only from the three RPCs below, which run SECURITY
--                 | DEFINER and self-check is_admin() first.
--   Documentation | docs/rls-permission-matrix.md §5 (new test plan row), §6 (gap 7
--                 | marked resolved).
--                 | Pending Bashir's review (this PR).
--
-- WHY A SHARED ADVISORY LOCK. A guard added to set_user_role alone does not close
--   the gap: even if set_user_role blocks a concurrent write to the row it is about
--   to touch, set_user_active does not know any lock exists, so once unblocked it
--   proceeds using state it read before it was blocked and can still zero out
--   admins. Every function that can remove an admin from the active set has to
--   serialize against the SAME lock for any of the guards to mean anything.
--   pg_advisory_xact_lock is scoped to the calling transaction and releases
--   automatically on commit or rollback — nothing to remember to release.
--
-- THREE CALL SITES, NOT TWO. set_user_role and set_user_active were the whole set
--   when gap 7 was written. F014 (20260730121500) added deactivate_user, which sets
--   is_active = false on its own path and would otherwise have kept the race alive
--   through a third door. Any future RPC writing users.role or users.is_active has
--   to call the guard too — that is why the lock lives in one shared function.
--
-- WHY THESE THREE ARE `create or replace`d WHOLESALE. Their bodies are carried
--   forward verbatim from the migrations that own them — set_user_role from
--   20260723100100, set_user_active and deactivate_user from 20260730121500 — with
--   nothing but the guard call added. A `create or replace` silently wins over every
--   earlier definition, so anything those migrations added and this one omitted would
--   be reverted without a single test failing (20260730121500's own header flags the
--   same hazard). If you edit any of the three, re-diff against its owning migration.
--
-- WHY THIS IS ONLY REACHABLE UNDER REAL CONCURRENCY, NOT A BUG IN THIS MIGRATION.
--   Any single, sequential, legitimately-authorised call to any of the three can
--   never by itself reduce the active-admin count to zero: reaching the guard means
--   the caller passed is_admin() and is not the target (self-change is already
--   refused in all three), so the caller is themselves a surviving active admin. The
--   guard's "would this hit zero?" branch is therefore only ever reachable when a
--   second transaction is racing the first — which is exactly the case this
--   migration exists to close, and exactly why it cannot be exercised by the
--   existing pgTAP suite (single session, single transaction). Proof that the race
--   is actually closed lives in scripts/verify-last-admin-guard.mts, which opens
--   real, concurrently-held connections.
--
-- Reversibility: paired rollback in ../rollback/20260804153000_last_admin_guard.down.sql

-- One fixed lock key, shared by every call site below. Held until the calling
-- transaction commits or rolls back, so a concurrent call touching any guarded path
-- blocks here until the first transaction resolves, then re-reads the admin count
-- fresh rather than trusting anything read before it was blocked.
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
  'Takes a shared advisory lock first so concurrent set_user_role, set_user_active '
  'and deactivate_user calls serialize against each other, not just against '
  'themselves (matrix §6 gap 7). Called only from within those SECURITY DEFINER '
  'bodies; granted to nobody directly, same as app.revoke_sessions.';

revoke execute on function app.guard_last_admin(uuid) from public;

-- ---------------------------------------------------------------------------
-- set_user_role: guard the demotion path
-- ---------------------------------------------------------------------------
-- One guard call, right before the update, only when the change actually removes
-- admin-ness (old role was admin, new role is not). Otherwise unchanged from
-- 20260723100100, except that both refusals now carry a stable HINT — PostgREST
-- surfaces it as error.hint, which is what the route switches on, so rewording a
-- message can never silently change what an admin reads (the same convention
-- set_user_active has used since 20260729232004).
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
      using errcode = '42501', hint = 'not_admin';
  end if;

  if p_user_id = v_actor then
    raise exception 'you cannot change your own role'
      using errcode = '42501', hint = 'self_role_change';
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
  'serialized against set_user_active and deactivate_user via app.guard_last_admin. '
  'Every refusal carries a HINT. Accepted advisor exception — an intentional, '
  'self-authorising RPC (matrix §7).';

revoke execute on function public.set_user_role(uuid, public.user_role) from public;
revoke execute on function public.set_user_role(uuid, public.user_role) from anon;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;

-- ---------------------------------------------------------------------------
-- set_user_active: guard the suspension path
-- ---------------------------------------------------------------------------
-- Body carried forward verbatim from 20260730121500 — including F014's
-- deactivated_at clearing on reactivation, without which the
-- users_deactivated_at_matches_inactive constraint rejects every reactivation, and
-- 20260729232500's app.revoke_sessions call. The only additions are the target's
-- role (needed to tell whether the suspension removes an active admin) and the
-- guard call itself.
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

  -- Matrix §6 gap 7. Only on the path that removes an active admin from the set;
  -- reactivation and suspending a non-admin take no lock at all.
  if v_role = 'admin' and v_was_active and not p_is_active then
    perform app.guard_last_admin(p_user_id);
  end if;

  -- Reactivation clears the deactivation marker; suspension leaves it as it was
  -- (null on this path, since a user cannot be suspended while already inactive —
  -- the no-op guard above returns first).
  update public.users
     set is_active      = p_is_active,
         deactivated_at = case when p_is_active then null else deactivated_at end
   where id = p_user_id;

  -- Carried forward from 20260729232500. Suspension signs them out for real.
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
  'transaction (app.revoke_sessions). F014: reactivation also clears deactivated_at, '
  'without which the users_deactivated_at_matches_inactive constraint would reject '
  'it. F012: refuses suspending the last active admin (matrix §6 gap 7), serialized '
  'against set_user_role and deactivate_user via app.guard_last_admin. '
  'Accepted advisor exception — an intentional, self-authorising RPC (matrix §7).';

revoke execute on function public.set_user_active(uuid, boolean) from public;
revoke execute on function public.set_user_active(uuid, boolean) from anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- deactivate_user: guard the offboarding path
-- ---------------------------------------------------------------------------
-- The third writer of users.is_active, added by F014 after gap 7 was written. Body
-- carried forward verbatim from 20260730121500; the only addition is the guard call
-- on the path that takes an active admin out of the set.
create or replace function public.deactivate_user(
  p_user_id         uuid,
  p_reason          text,
  p_reassign_to     uuid    default null,
  p_release_clients boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_target       public.users%rowtype;
  v_destination  public.users%rowtype;
  v_owned_count  integer;
  v_reason       text := nullif(btrim(p_reason), '');
begin
  -- Authorisation, re-checked inside the definer boundary (same reasoning as
  -- set_user_role and set_user_active: SECURITY DEFINER bypasses the RLS that would
  -- otherwise stop a non-admin). Every refusal carries a stable HINT — PostgREST
  -- surfaces it as error.hint, which is what the route switches on, so rewording a
  -- message never changes behaviour.
  if not app.is_admin() then
    raise exception 'only an admin may deactivate a user'
      using errcode = '42501', hint = 'not_admin';
  end if;

  -- Self-deactivation is instant self-lockout with no way back: is_active is writable
  -- by nothing but these RPCs, and the very next statement would be refused. This is
  -- also what guarantees an active admin survives — reaching this line means the
  -- caller is an active admin who is not the target.
  if p_user_id = v_actor then
    raise exception 'you cannot deactivate your own account'
      using errcode = '42501', hint = 'self_access_change';
  end if;

  if v_reason is null then
    raise exception 'a reason is required to deactivate a user'
      using errcode = '22023', hint = 'reason_required';
  end if;

  select * into v_target from public.users where id = p_user_id;
  if not found then
    raise exception 'user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  -- Already deactivated is a no-op, not an error: two admins pressing the button on the
  -- same row should not produce a second audit entry or a second reassignment sweep.
  -- Suspended-but-not-deactivated falls through deliberately — deactivating a suspended
  -- user is a real transition and the offboarding still has to happen.
  if v_target.deactivated_at is not null then
    return jsonb_build_object(
      'user_id', p_user_id, 'already_deactivated', true, 'clients_moved', 0
    );
  end if;

  -- A destination and a release are mutually exclusive. Left as two independent
  -- arguments they could both arrive set, and the function would have to invent a
  -- precedence rule that no caller could see.
  if p_reassign_to is not null and p_release_clients then
    raise exception 'choose either a new owner or release to the unowned pool, not both'
      using errcode = '22023', hint = 'ambiguous_destination';
  end if;

  if p_reassign_to is not null then
    if p_reassign_to = p_user_id then
      raise exception 'clients cannot be reassigned to the user being deactivated'
        using errcode = '22023', hint = 'reassign_to_self';
    end if;

    select * into v_destination from public.users where id = p_reassign_to;
    if not found then
      raise exception 'destination user % not found', p_reassign_to
        using errcode = 'P0002', hint = 'destination_not_found';
    end if;

    -- Handing clients to an inactive account recreates the problem this function
    -- exists to prevent, and a viewer may not own anything (admin-role matrix).
    if not v_destination.is_active or v_destination.role = 'viewer' then
      raise exception 'clients can only be reassigned to an active CAM or admin'
        using errcode = '22023', hint = 'destination_not_eligible';
    end if;
  end if;

  select count(*) into v_owned_count
    from public.organisations where owner_id = p_user_id;

  -- F014 AC2: no client is left ownerless. The admin must say where the work goes
  -- before the account closes. PRD §6.12 allows either destination — a named CAM, or
  -- back to the unowned pool where any CAM may claim it (viewer_role_write_lockout
  -- only permits a CAM to claim a row whose owner_id is null).
  if v_owned_count > 0 and p_reassign_to is null and not p_release_clients then
    raise exception
      'this user still owns % client(s); reassign or release them first', v_owned_count
      using errcode = '22023', hint = 'owns_active_clients';
  end if;

  -- Audit one row per organisation, before the update, so `from` is still readable.
  -- Per-organisation rather than one summary row: the client timeline is read by
  -- humans asking "why did my owner change", and that answer should live on the
  -- organisation's own history, not only on the departing user's.
  if v_owned_count > 0 then
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    select
      v_actor,
      'ownership_reassigned',
      'organisations',
      o.id,
      jsonb_build_object(
        'from', p_user_id,
        'to', p_reassign_to,
        'reason', v_reason,
        'trigger', 'user_deactivated'
      )
    from public.organisations o
    where o.owner_id = p_user_id;

    -- p_reassign_to is null on the release path, which is exactly the unowned state.
    update public.organisations
       set owner_id = p_reassign_to
     where owner_id = p_user_id;
  end if;

  -- Matrix §6 gap 7. This function is the third writer of is_active, so it has to take
  -- the same lock as set_user_role and set_user_active or the race simply moves here:
  -- B deactivates A while A demotes B, each reading an admin count taken before the
  -- other committed. The self-deactivation refusal above is not enough on its own,
  -- for exactly the reason the gap was raised against set_user_active's.
  if v_target.role = 'admin' and v_target.is_active then
    perform app.guard_last_admin(p_user_id);
  end if;

  update public.users
     set is_active      = false,
         deactivated_at = now()
   where id = p_user_id;

  -- Same revocation a suspension performs (20260729232500), and for the same reason:
  -- the flag denies them every row, but only deleting the session invalidates a token
  -- already in their browser. Here it is in the same transaction as the reassignment
  -- too, so an offboarded CAM cannot still be holding a working session over clients
  -- that have already moved to someone else.
  perform app.revoke_sessions(p_user_id);

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    'user_deactivated',
    'users', p_user_id,
    jsonb_build_object(
      'reason', v_reason,
      'was_active', v_target.is_active,
      'clients_moved', v_owned_count,
      'reassigned_to', p_reassign_to,
      'released_to_pool', p_release_clients
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'already_deactivated', false,
    'clients_moved', v_owned_count,
    'reassigned_to', p_reassign_to,
    'released_to_pool', p_release_clients
  );
end;
$$;

comment on function public.deactivate_user(uuid, text, uuid, boolean) is
  'F014: admin-only deactivation (offboarding). Refuses while the user owns clients '
  'unless given a destination — a new owner or the unowned pool — and moves them in '
  'the same transaction (AC2). Sets is_active = false and deactivated_at; deletes '
  'nothing, so the audit trail survives (AC3, AC4). Requires a written reason '
  '(PRD §4.2). F012: refuses deactivating the last active admin (matrix §6 gap 7), '
  'serialized against set_user_role and set_user_active via app.guard_last_admin. '
  'Accepted advisor exception — a self-authorising RPC (matrix §7).';

revoke execute on function public.deactivate_user(uuid, text, uuid, boolean) from public;
revoke execute on function public.deactivate_user(uuid, text, uuid, boolean) from anon;
grant execute on function public.deactivate_user(uuid, text, uuid, boolean) to authenticated;
