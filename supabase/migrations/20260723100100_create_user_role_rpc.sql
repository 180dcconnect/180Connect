-- Migration: create_user_role_rpc
-- Sequence: addition (after create_audit_log; needs public.users, app.is_admin, audit_log).
-- Story: F012 Edit User Role — the write-path the matrix reserves for an admin RPC.
--   Built here because F224 made role RPC-only (a direct `update ... set role` is 42501
--   for everyone), so without this nobody can change a role at all.
-- Spec: docs/rls-permission-matrix.md §2, §3.1
--
-- WHY AN RPC, AND WHY SECURITY DEFINER:
--   users.role is granted to no one (matrix §2.1), so no policy or INVOKER function can
--   write it — the change has to run as the table owner. SECURITY DEFINER does that.
--   The function then re-checks app.is_admin() ITSELF, because SECURITY DEFINER bypasses
--   the RLS that would otherwise stop a non-admin. It is intentionally in `public` so it
--   is reachable as a PostgREST RPC (the admin UI calls /rest/v1/rpc/set_user_role) —
--   this is the one SECURITY DEFINER function we accept the advisor flag on, precisely
--   because it must be callable and it self-authorises (docs/rls-permission-matrix.md §7).
--
-- Reversibility: paired rollback in ../rollback/20260723100100_create_user_role_rpc.down.sql

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

comment on function public.set_user_role(uuid, public.user_role) is
  'F012: admin-only role change. SECURITY DEFINER because users.role is granted to no '
  'one; self-checks app.is_admin() and writes an audit_log row. Cannot change your own '
  'role. Accepted advisor exception — an intentional, self-authorising RPC (matrix §7).';

-- anon can never call it; authenticated can (the body rejects non-admins). Revoke from
-- public AND anon explicitly: EXECUTE defaults to public on create, and Supabase also
-- default-grants execute to anon, which a public revoke alone does not remove.
revoke execute on function public.set_user_role(uuid, public.user_role) from public;
revoke execute on function public.set_user_role(uuid, public.user_role) from anon;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;
