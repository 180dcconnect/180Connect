-- Rollback for: 20260804153000_last_admin_guard.sql
-- Story: F012 (#14)
-- Apply manually against the target DB to reverse the paired migration.
--
-- Restores set_user_role, set_user_active and deactivate_user to their pre-guard
-- bodies first, so nothing still references app.guard_last_admin when it is dropped.
--
-- The bodies below are copied from the migrations that own them — set_user_role from
-- 20260723100100, set_user_active and deactivate_user from 20260730121500 — not from
-- an older revision of either. Rolling back to a body that predates F014 would drop
-- the deactivated_at clearing on reactivation and leave every reactivation failing on
-- the users_deactivated_at_matches_inactive constraint.
--
-- WHAT IS LOST: the concurrent-admin-lockout protection from matrix §6 gap 7. Two
-- admins acting on each other at the same moment (one demoting the other via
-- set_user_role while the second suspends them via set_user_active, or deactivates
-- them via deactivate_user) can once again jointly commit to zero active admins,
-- which nothing in the app can then reverse. The HINTs added to set_user_role's
-- refusals go too, so the route falls back to its generic role-change message.
-- Nothing else regresses — all three RPCs return to exactly their prior,
-- already-shipped behaviour.

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
  -- Authorisation, re-checked inside the definer boundary.
  if not app.is_admin() then
    raise exception 'only an admin may change a user role'
      using errcode = '42501';
  end if;

  -- A safety rail, not a permission rule: an admin does not change their own role.
  -- Prevents an accidental self-demotion / self-lockout, and self-dealing. Changing
  -- another admin is still allowed.
  if p_user_id = v_actor then
    raise exception 'you cannot change your own role'
      using errcode = '42501';
  end if;

  select role into v_old_role from public.users where id = p_user_id;
  if v_old_role is null then
    raise exception 'user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  -- No-op changes are not audited — the trail records real transitions only.
  if v_old_role = p_new_role then
    return;
  end if;

  update public.users set role = p_new_role where id = p_user_id;

  -- PRD §4.2: role changes must be audited. Same transaction as the change, so the
  -- two cannot diverge.
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'role_changed', 'users', p_user_id,
    jsonb_build_object('from', v_old_role, 'to', p_new_role)
  );
end;
$$;

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

drop function if exists app.guard_last_admin(uuid);
