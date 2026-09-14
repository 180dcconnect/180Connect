-- Rollback: replace_deactivation_with_delete
--
-- Reverses the schema and the functions. A redaction does not reverse — accounts
-- delete_user redacted stay redacted and accounts it hard-deleted stay deleted; that
-- is the point of it. Redacted accounts become deactivated ones, the nearest state
-- the old model has.
--
-- Order matters: deactivated_at is back before any restored function can read it,
-- and deleted_at goes only after nothing that survives still selects it.

drop function if exists public.delete_user(uuid, text, uuid, boolean);
drop function if exists public.suspend_user(uuid, text, uuid, boolean);
drop function if exists app.transfer_user_work(uuid, text, uuid, boolean);

alter table public.users
  add column if not exists deactivated_at timestamptz;

update public.users
   set deactivated_at = deleted_at
 where deleted_at is not null;

alter table public.users
  add constraint users_deactivated_at_matches_inactive
  check (deactivated_at is null or is_active = false);

-- set_user_active and set_user_role as 20260804153000_last_admin_guard defined them —
-- the definitions this migration replaced. They read deactivated_at, not deleted_at.
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

revoke execute on function public.set_user_active(uuid, boolean) from public;
revoke execute on function public.set_user_active(uuid, boolean) from anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;

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

revoke execute on function public.set_user_role(uuid, public.user_role) from public;
revoke execute on function public.set_user_role(uuid, public.user_role) from anon;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;

-- deactivate_user as 20260804170000_unify_offboarding_reassignment defined it.
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
  v_actor         uuid := (select auth.uid());
  v_target        public.users%rowtype;
  v_destination   public.users%rowtype;
  v_owned_count   integer;
  v_owned_ids     uuid[];
  v_reason        text := nullif(btrim(p_reason), '');
  v_transfer      jsonb := jsonb_build_object('organisations_moved', 0, 'actions_moved', 0);
  v_stray_actions uuid[];
  v_stray_result  jsonb := jsonb_build_object('actions_moved', 0);
begin
  if not app.is_admin() then
    raise exception 'only an admin may deactivate a user'
      using errcode = '42501', hint = 'not_admin';
  end if;

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

  if v_target.deactivated_at is not null then
    return jsonb_build_object(
      'user_id', p_user_id, 'already_deactivated', true,
      'clients_moved', 0, 'actions_moved', 0
    );
  end if;

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

    if not v_destination.is_active or v_destination.role = 'viewer' then
      raise exception 'clients can only be reassigned to an active CAM or admin'
        using errcode = '22023', hint = 'destination_not_eligible';
    end if;
  end if;

  select array_agg(o.id), count(*)
    into v_owned_ids, v_owned_count
    from public.organisations o where o.owner_id = p_user_id;
  v_owned_count := coalesce(v_owned_count, 0);

  -- F014 AC2: no client is left ownerless. The admin must say where the work goes
  -- before the account closes.
  if v_owned_count > 0 and p_reassign_to is null and not p_release_clients then
    raise exception
      'this user still owns % client(s); reassign or release them first', v_owned_count
      using errcode = '22023', hint = 'owns_active_clients';
  end if;

  -- Delegated, rather than a second UPDATE + audit block here. reassign_ownership does
  -- the per-organisation audit row this function used to write itself, and it also
  -- moves the open actions, which is the part that was missing. p_reassign_to is null
  -- on the release path, which the function now reads as "return to the unowned pool".
  if v_owned_count > 0 then
    v_transfer := public.reassign_ownership(
      v_owned_ids, p_reassign_to, v_reason, p_user_id
    );
  end if;

  -- Work an admin assigned to this user on someone else's client (F169). Ownership
  -- cannot reach it — those clients belong to CAMs who are not leaving — so it is
  -- collected by assignee and moved separately, exactly as /admin/offboard does.
  select array_agg(a.id) into v_stray_actions
    from public.actions a
   where a.assignee_user_id = p_user_id and a.status = 'open';

  if v_stray_actions is not null and p_reassign_to is not null then
    v_stray_result := public.reassign_actions(v_stray_actions, p_reassign_to, v_reason);
  elsif v_stray_actions is not null then
    -- Released: nobody to hand them to, so they are unassigned and surface as
    -- unowned work rather than sitting with a closed account.
    update public.actions
       set assignee_user_id = null
     where id = any(v_stray_actions);
    v_stray_result := jsonb_build_object('actions_moved', cardinality(v_stray_actions));
  end if;

  -- Matrix §6 gap 7 (20260804153000). This function is the third writer of
  -- is_active, so it takes the same shared advisory lock as set_user_role and
  -- set_user_active or the race simply moves here. Carried forward rather than
  -- dropped: this migration now runs after last_admin_guard and its
  -- `create or replace` would otherwise silently revert the guard.
  if v_target.role = 'admin' and v_target.is_active then
    perform app.guard_last_admin(p_user_id);
  end if;

  update public.users
     set is_active      = false,
         deactivated_at = now()
   where id = p_user_id;

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
      'actions_moved',
        (v_transfer->>'actions_moved')::int + (v_stray_result->>'actions_moved')::int,
      'reassigned_to', p_reassign_to,
      'released_to_pool', p_release_clients
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'already_deactivated', false,
    'clients_moved', v_owned_count,
    'actions_moved',
      (v_transfer->>'actions_moved')::int + (v_stray_result->>'actions_moved')::int,
    'reassigned_to', p_reassign_to,
    'released_to_pool', p_release_clients
  );
end;
$$;

revoke execute on function public.deactivate_user(uuid, text, uuid, boolean) from public;
revoke execute on function public.deactivate_user(uuid, text, uuid, boolean) from anon;
grant execute on function public.deactivate_user(uuid, text, uuid, boolean) to authenticated;

alter table public.users
  drop constraint if exists users_deleted_at_implies_inactive;

alter table public.users
  drop column if exists deleted_at;
