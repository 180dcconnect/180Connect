-- Rollback for: 20260729232500_revoke_sessions_on_suspend.sql
-- Story: F013 (#15)
-- Apply manually against the target DB to reverse the paired migration.
--
-- Restores set_user_active to its 20260729232004 body first, so nothing still
-- references app.revoke_sessions when it is dropped.
--
-- WHAT IS LOST: suspension goes back to flipping is_active without signing the user
-- out. They are denied every row by RLS immediately, but an access token already
-- issued keeps resolving until it expires — the logged-in-looking shell F013 AC2 set
-- out to remove. Nothing else regresses.

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

drop function if exists app.revoke_sessions(uuid);
