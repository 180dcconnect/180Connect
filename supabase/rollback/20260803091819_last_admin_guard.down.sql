-- Rollback for: 20260803091819_last_admin_guard.sql
-- Story: F012 (#14)
-- Apply manually against the target DB to reverse the paired migration.
--
-- Restores set_user_role and set_user_active to their pre-guard bodies first, so
-- nothing still references app.guard_last_admin when it is dropped.
--
-- WHAT IS LOST: the concurrent-admin-lockout protection from matrix §6 gap 7. Two
-- admins acting on each other at the same moment (one demoting the other via
-- set_user_role while the second suspends the first via set_user_active) can once
-- again jointly commit to zero active admins, which nothing in the app can then
-- reverse. Nothing else regresses — both RPCs return to exactly their prior,
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

  update public.users set role = p_new_role where id = p_user_id;

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

drop function if exists app.guard_last_admin(uuid);
