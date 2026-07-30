-- Rollback for: 20260730121500_create_deactivate_user_rpc.sql
-- Story: F014 (#16)
-- Apply manually against the target DB to reverse the paired migration.
--
-- Order matters. Drop the constraint before the column so the intermediate state is
-- never one where a row could be written that the constraint would have rejected, and
-- restore set_user_active to its F013 body *before* dropping deactivated_at — the
-- current body references that column, and a function whose body names a dropped
-- column fails at call time, not at drop time.
--
-- WHAT IS LOST: deactivated_at is dropped, so the distinction between suspended and
-- deactivated disappears from users. Anyone deactivated stays is_active = false —
-- correctly locked out — but reads as merely suspended, and set_user_active can
-- reactivate them without the offboarding ever being acknowledged. The audit_log
-- 'user_deactivated' rows survive and remain the record of who was offboarded, when,
-- by whom and why; the reassignments they describe are not reversed by this script.

drop function if exists public.deactivate_user(uuid, text, uuid, boolean);

-- set_user_active restored to its F013 body (20260729232004), minus the
-- deactivated_at clear.
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

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_is_active then 'user_reactivated' else 'user_suspended' end,
    'users', p_user_id,
    jsonb_build_object('from', v_was_active, 'to', p_is_active)
  );
end;
$$;

alter table public.users
  drop constraint if exists users_deactivated_at_matches_inactive;

alter table public.users
  drop column if exists deactivated_at;
