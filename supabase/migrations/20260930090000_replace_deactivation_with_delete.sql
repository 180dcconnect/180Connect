-- Migration: replace_deactivation_with_delete
-- Sequence: addition (after unify_offboarding_reassignment and last_admin_guard — this
--   `create or replace`s set_user_role and set_user_active again and must carry the
--   app.guard_last_admin() and app.revoke_sessions() calls forward).
-- Story: F014 Delete or Deactivate User — revisited.
-- Spec: docs/rls-permission-matrix.md §3.1; docs/data-lifecycle-policy.md §5.3, Annex A.
--
-- THE DECISION THIS IMPLEMENTS:
--   Suspension and deactivation were the same state. Both set is_active = false and
--   revoked sessions; deactivation additionally forced the admin to hand the user's
--   clients on and stamped deactivated_at so the UI could call it something different.
--   Two names for one lock, and still no way to actually remove anyone.
--
--   Now there are two actions that genuinely differ:
--
--   Suspend  — reversible. Blocks access and signs the user out. Handing their clients
--              and open actions on is *offered* (suspend_user), not required.
--   Delete   — irreversible. Clients and open actions must go somewhere first. Then:
--              · no history → the account is physically deleted;
--              · history    → the account is redacted (data-lifecycle-policy §5.3
--                             Level 2): name and email replaced with non-identifying
--                             placeholders in public.users and auth.users, row kept so
--                             every note, approval and audit row keeps its author.
--
--   "History" is decided by the catalog, not a hand-kept list: any row in any table
--   whose foreign key to public.users is not ON DELETE CASCADE. A new table that
--   references users is covered the day it ships. Cascading tables (saved views,
--   preferences, onboarding, inbox thread state, the AI rate limit) are the user's own
--   settings and go either way.
--
--   Deactivation is removed: deactivate_user is dropped, deactivated_at is dropped, and
--   every account that was deactivated becomes an ordinary suspended account — which is
--   what it already was in every respect except the label. Historical user_deactivated
--   audit rows are kept and still rendered.
--
-- Schema change approval record (SOP §7):
--   Change        | USERS: add deleted_at (+ CHECK), drop deactivated_at (+ its CHECK).
--                 | Add app.transfer_user_work, public.suspend_user, public.delete_user.
--                 | Replace set_user_active, set_user_role (refuse a deleted account).
--                 | Drop public.deactivate_user.
--   Reason        | Suspend and deactivate were one state under two names; no way to
--                 | remove a user existed.
--   Compatibility | Breaking for callers of deactivate_user — the only one is
--                 | /api/admin/users, changed in the same PR. Deactivated accounts keep
--                 | is_active = false and read as suspended.
--   Data migration| deactivated_at is discarded (it only labelled is_active = false).
--                 | The F188 tag placeholder account is marked deleted_at so it stops
--                 | appearing as a suspended team member.
--   Security      | Both new RPCs SECURITY DEFINER, admin self-checked, reason required,
--                 | audited, last-admin guarded, sessions revoked in-transaction.
--   Documentation | Matrix §3.1 / §6, data-lifecycle-policy §5.3 + Annex A.1, Data Model
--                 | tab 04 USERS + tab 02.
--                 | Approved by Bashir (Project Leader), 13 Sep 2026.
--
-- Reversibility: paired rollback in ../rollback/20260930090000_replace_deactivation_with_delete.down.sql
--   The schema reverses; a redaction does not. That is the point of it.

-- ---------------------------------------------------------------------------
-- USERS.deleted_at
-- ---------------------------------------------------------------------------
alter table public.users
  add column deleted_at timestamptz;

comment on column public.users.deleted_at is
  'When the account was deleted by delete_user and its personal details redacted. '
  'Null on active and suspended accounts. Never cleared: a deleted account cannot be '
  'reactivated. Only set on accounts that had history — an account without any is '
  'physically deleted instead, so no row is left to carry this.';

-- A deleted account that could still log in would be the worst possible combination.
alter table public.users
  add constraint users_deleted_at_implies_inactive
  check (deleted_at is null or is_active = false);

-- The placeholder that tags are reassigned to (20260821120100) is not a person and
-- never was; marking it deleted takes it out of every team list without special-casing
-- its id in application code.
update public.users
   set deleted_at = now()
 where id = '00000000-0000-0000-0000-000000000001'
   and is_active = false;

-- ---------------------------------------------------------------------------
-- Remove deactivation
-- ---------------------------------------------------------------------------
drop function if exists public.deactivate_user(uuid, text, uuid, boolean);

alter table public.users
  drop constraint if exists users_deactivated_at_matches_inactive;

alter table public.users
  drop column if exists deactivated_at;

-- ---------------------------------------------------------------------------
-- app.transfer_user_work — the handover half of the old deactivate_user
-- ---------------------------------------------------------------------------
-- Moves every client the user owns (with the open actions on them) and every open
-- action assigned to them on someone else's client (F169). A null p_reassign_to with
-- p_release_clients = true returns the clients to the unowned pool and unassigns the
-- actions. Called only from suspend_user and delete_user, after they have checked the
-- caller; granted to nobody.
create or replace function app.transfer_user_work(
  p_user_id         uuid,
  p_reason          text,
  p_reassign_to     uuid,
  p_release_clients boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason        text := nullif(btrim(p_reason), '');
  v_destination   public.users%rowtype;
  v_owned_ids     uuid[];
  v_transfer      jsonb := jsonb_build_object('organisations_moved', 0, 'actions_moved', 0);
  v_stray_actions uuid[];
  v_stray_moved   integer := 0;
begin
  if v_reason is null then
    raise exception 'a reason is required so the handover can be understood later'
      using errcode = '22023', hint = 'reason_required';
  end if;

  if p_reassign_to is not null and p_release_clients then
    raise exception 'choose either a new owner or release to the unowned pool, not both'
      using errcode = '22023', hint = 'ambiguous_destination';
  end if;

  if p_reassign_to is not null then
    if p_reassign_to = p_user_id then
      raise exception 'clients cannot be reassigned to the user they are being taken from'
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
  elsif not p_release_clients then
    -- Nothing to do: the caller asked for no handover.
    return jsonb_build_object('clients_moved', 0, 'actions_moved', 0);
  end if;

  select array_agg(o.id) into v_owned_ids
    from public.organisations o where o.owner_id = p_user_id;

  if v_owned_ids is not null then
    v_transfer := public.reassign_ownership(v_owned_ids, p_reassign_to, v_reason, p_user_id);
  end if;

  select array_agg(a.id) into v_stray_actions
    from public.actions a
   where a.assignee_user_id = p_user_id and a.status = 'open';

  if v_stray_actions is not null and p_reassign_to is not null then
    v_stray_moved := (public.reassign_actions(v_stray_actions, p_reassign_to, v_reason)
                        ->>'actions_moved')::int;
  elsif v_stray_actions is not null then
    update public.actions
       set assignee_user_id = null
     where id = any(v_stray_actions);
    v_stray_moved := cardinality(v_stray_actions);
  end if;

  return jsonb_build_object(
    'clients_moved', coalesce(cardinality(v_owned_ids), 0),
    'actions_moved', (v_transfer->>'actions_moved')::int + v_stray_moved
  );
end;
$$;

comment on function app.transfer_user_work(uuid, text, uuid, boolean) is
  'Hands a user''s clients and open actions to an active CAM/admin, or releases them '
  'to the unowned pool. Delegates to reassign_ownership and reassign_actions so the '
  'audit rows are the same as every other handover. Called only from suspend_user and '
  'delete_user; granted to nobody.';

revoke execute on function app.transfer_user_work(uuid, text, uuid, boolean) from public;

-- ---------------------------------------------------------------------------
-- set_user_active — a deleted account cannot be reactivated
-- ---------------------------------------------------------------------------
-- Carried forward from 20260804153000 with two changes: the deactivated_at clearing is
-- gone with the column, and reactivating a deleted account is refused. Keeps
-- app.guard_last_admin and app.revoke_sessions.
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
  v_deleted_at timestamptz;
begin
  if not app.is_admin() then
    raise exception 'only an admin may change a user''s access'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if p_user_id = v_actor then
    raise exception 'you cannot change your own access'
      using errcode = '42501', hint = 'self_access_change';
  end if;

  select role, is_active, deleted_at into v_role, v_was_active, v_deleted_at
    from public.users where id = p_user_id;
  if not found then
    raise exception 'user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  if v_deleted_at is not null and p_is_active then
    raise exception 'a deleted account cannot be reactivated'
      using errcode = '22023', hint = 'user_deleted';
  end if;

  if v_was_active = p_is_active then
    return;
  end if;

  if v_role = 'admin' and v_was_active and not p_is_active then
    perform app.guard_last_admin(p_user_id);
  end if;

  update public.users
     set is_active = p_is_active
   where id = p_user_id;

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
  'transaction (app.revoke_sessions). Refuses reactivating a deleted account. F012: '
  'refuses suspending the last active admin (matrix §6 gap 7) via app.guard_last_admin. '
  'Accepted advisor exception — an intentional, self-authorising RPC (matrix §7).';

revoke execute on function public.set_user_active(uuid, boolean) from public;
revoke execute on function public.set_user_active(uuid, boolean) from anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- set_user_role — a deleted account's role is frozen
-- ---------------------------------------------------------------------------
-- Carried forward from 20260804153000; the only addition is the deleted check.
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
  v_actor      uuid := (select auth.uid());
  v_old_role   public.user_role;
  v_deleted_at timestamptz;
begin
  if not app.is_admin() then
    raise exception 'only an admin may change a user role'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if p_user_id = v_actor then
    raise exception 'you cannot change your own role'
      using errcode = '42501', hint = 'self_role_change';
  end if;

  select role, deleted_at into v_old_role, v_deleted_at
    from public.users where id = p_user_id;
  if v_old_role is null then
    raise exception 'user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  if v_deleted_at is not null then
    raise exception 'a deleted account''s role cannot be changed'
      using errcode = '22023', hint = 'user_deleted';
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
  'own role or a deleted account''s. Refuses a demotion that would leave no active '
  'admin (matrix §6 gap 7) via app.guard_last_admin. Every refusal carries a HINT. '
  'Accepted advisor exception — an intentional, self-authorising RPC (matrix §7).';

revoke execute on function public.set_user_role(uuid, public.user_role) from public;
revoke execute on function public.set_user_role(uuid, public.user_role) from anon;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;

-- ---------------------------------------------------------------------------
-- suspend_user — suspension with an optional handover
-- ---------------------------------------------------------------------------
-- The handover and the suspension commit together or not at all. With no destination
-- this is exactly set_user_active(p_user_id, false). A destination on an account that is
-- already suspended still moves the work — handing a suspended CAM's clients on later
-- is a real need, and the suspension itself is then a no-op.
create or replace function public.suspend_user(
  p_user_id         uuid,
  p_reason          text    default null,
  p_reassign_to     uuid    default null,
  p_release_clients boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_deleted_at timestamptz;
  v_transfer   jsonb := jsonb_build_object('clients_moved', 0, 'actions_moved', 0);
begin
  if not app.is_admin() then
    raise exception 'only an admin may suspend a user'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if p_user_id = v_actor then
    raise exception 'you cannot suspend your own account'
      using errcode = '42501', hint = 'self_access_change';
  end if;

  select deleted_at into v_deleted_at from public.users where id = p_user_id;
  if not found then
    raise exception 'user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  if v_deleted_at is not null then
    raise exception 'this account has been deleted'
      using errcode = '22023', hint = 'user_deleted';
  end if;

  if p_reassign_to is not null or p_release_clients then
    v_transfer := app.transfer_user_work(p_user_id, p_reason, p_reassign_to, p_release_clients);
  end if;

  perform public.set_user_active(p_user_id, false);

  return jsonb_build_object(
    'user_id',       p_user_id,
    'clients_moved', (v_transfer->>'clients_moved')::int,
    'actions_moved', (v_transfer->>'actions_moved')::int
  );
end;
$$;

comment on function public.suspend_user(uuid, text, uuid, boolean) is
  'Admin-only suspension with an optional handover of the user''s clients and open '
  'actions (to an active CAM/admin, or the unowned pool), in one transaction. The '
  'suspension itself is set_user_active — same guard, same session revocation, same '
  'user_suspended audit row. A reason is required only when work is moved. Accepted '
  'advisor exception — self-authorising RPC (matrix §7).';

revoke execute on function public.suspend_user(uuid, text, uuid, boolean) from public;
revoke execute on function public.suspend_user(uuid, text, uuid, boolean) from anon;
grant execute on function public.suspend_user(uuid, text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_user — irreversible removal: hard delete, or redaction if there is history
-- ---------------------------------------------------------------------------
create or replace function public.delete_user(
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
  v_actor       uuid := (select auth.uid());
  v_reason      text := nullif(btrim(p_reason), '');
  v_target      public.users%rowtype;
  v_owned_count integer;
  v_transfer    jsonb;
  v_fk          record;
  v_referenced  boolean;
  v_history     boolean := false;
  v_mode        text;
  v_tombstone   text;
begin
  if not app.is_admin() then
    raise exception 'only an admin may delete a user'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if p_user_id = v_actor then
    raise exception 'you cannot delete your own account'
      using errcode = '42501', hint = 'self_access_change';
  end if;

  if v_reason is null then
    raise exception 'a reason is required to delete a user'
      using errcode = '22023', hint = 'reason_required';
  end if;

  select * into v_target from public.users where id = p_user_id for update;
  if not found then
    raise exception 'user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  if v_target.deleted_at is not null then
    return jsonb_build_object(
      'user_id', p_user_id, 'already_deleted', true,
      'mode', 'redacted', 'clients_moved', 0, 'actions_moved', 0
    );
  end if;

  -- Checked here, not left to transfer_user_work: the call below derives its own
  -- release flag, so the caller's p_release_clients never reaches that check.
  if p_reassign_to is not null and p_release_clients then
    raise exception 'choose either a new owner or release to the unowned pool, not both'
      using errcode = '22023', hint = 'ambiguous_destination';
  end if;

  -- No client is left owned by an account that no longer exists. Unlike suspension,
  -- nobody can ever come back to them, so the admin must say where they go.
  select count(*) into v_owned_count
    from public.organisations o where o.owner_id = p_user_id;

  if v_owned_count > 0 and p_reassign_to is null and not p_release_clients then
    raise exception
      'this user still owns % client(s); reassign or release them first', v_owned_count
      using errcode = '22023', hint = 'owns_active_clients';
  end if;

  -- With no destination the user owns nothing, so "release" reaches only open actions
  -- assigned to them on other clients — which must not stay with a deleted account.
  v_transfer := app.transfer_user_work(
    p_user_id, v_reason, p_reassign_to, p_reassign_to is null
  );

  if v_target.role = 'admin' and v_target.is_active then
    perform app.guard_last_admin(p_user_id);
  end if;

  perform app.revoke_sessions(p_user_id);

  -- Their inbox is theirs, not history. Removed either way, and before the history
  -- check so notifications they merely received do not force a redaction.
  delete from public.notifications where recipient_user_id = p_user_id;

  -- History: any row, in any table, whose foreign key to users would not cascade away
  -- with the account. Read from the catalog so a table added later is covered without
  -- anyone remembering to add it here.
  for v_fk in
    select c.conrelid::regclass as table_name, a.attname as column_name
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.users'::regclass
       and cardinality(c.conkey) = 1
       and c.confdeltype <> 'c'
  loop
    execute format('select exists (select 1 from %s where %I = $1)',
                   v_fk.table_name, v_fk.column_name)
      into v_referenced
      using p_user_id;
    if v_referenced then
      v_history := true;
      exit;
    end if;
  end loop;

  v_mode := case when v_history then 'redacted' else 'deleted' end;

  -- Identified by id only (policy §5.3: never by name). Written before a hard delete;
  -- target_id is not a foreign key, so the row outlives the account.
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'user_deleted', 'users', p_user_id,
    jsonb_build_object(
      'reason',           v_reason,
      'mode',             v_mode,
      'was_active',       v_target.is_active,
      'clients_moved',    (v_transfer->>'clients_moved')::int,
      'actions_moved',    (v_transfer->>'actions_moved')::int,
      'reassigned_to',    p_reassign_to,
      'released_to_pool', p_reassign_to is null and v_owned_count > 0
    )
  );

  if v_mode = 'deleted' then
    -- Cascades to public.users and from there to the user's own settings tables.
    delete from auth.users where id = p_user_id;
  else
    -- Level 2 redaction (data-lifecycle-policy Annex A.1). The user's own settings go
    -- exactly as a cascade would have taken them.
    for v_fk in
      select c.conrelid::regclass as table_name, a.attname as column_name
        from pg_catalog.pg_constraint c
        join pg_catalog.pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f'
         and c.confrelid = 'public.users'::regclass
         and cardinality(c.conkey) = 1
         and c.confdeltype = 'c'
    loop
      execute format('delete from %s where %I = $1', v_fk.table_name, v_fk.column_name)
        using p_user_id;
    end loop;

    -- .invalid is reserved (RFC 2606) and can never be delivered to.
    v_tombstone := 'redacted+' || p_user_id::text || '@invalid';

    update public.users
       set email      = v_tombstone,
           full_name  = 'Former member',
           is_active  = false,
           deleted_at = now()
     where id = p_user_id;

    -- Both schemas (Annex A.1): auth.users keeps its own copy of the address. The
    -- original email is freed, so the same person can be invited again as a new user.
    update auth.users
       set email                      = v_tombstone,
           phone                      = null,
           raw_user_meta_data         = '{}'::jsonb,
           encrypted_password         = null,
           banned_until               = 'infinity',
           confirmation_token         = '',
           recovery_token             = '',
           email_change               = '',
           email_change_token_new     = '',
           email_change_token_current = '',
           reauthentication_token     = ''
     where id = p_user_id;

    delete from auth.identities      where user_id = p_user_id;
    delete from auth.mfa_factors     where user_id = p_user_id;
    delete from auth.one_time_tokens where user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'user_id',         p_user_id,
    'already_deleted', false,
    'mode',            v_mode,
    'clients_moved',   (v_transfer->>'clients_moved')::int,
    'actions_moved',   (v_transfer->>'actions_moved')::int
  );
end;
$$;

comment on function public.delete_user(uuid, text, uuid, boolean) is
  'Admin-only, irreversible account removal. Refuses while the user owns clients unless '
  'given a destination; moves clients and open actions in the same transaction. Then '
  'physically deletes an account with no history, or redacts one with history '
  '(data-lifecycle-policy §5.3 Level 2): name and email replaced in public.users and '
  'auth.users, identities and MFA factors removed, row kept so authorship survives. '
  'History = any row whose FK to users does not cascade, read from the catalog. '
  'Requires a reason, writes user_deleted (by id only), revokes sessions, refuses the '
  'last active admin via app.guard_last_admin. Accepted advisor exception — '
  'self-authorising RPC (matrix §7).';

revoke execute on function public.delete_user(uuid, text, uuid, boolean) from public;
revoke execute on function public.delete_user(uuid, text, uuid, boolean) from anon;
grant execute on function public.delete_user(uuid, text, uuid, boolean) to authenticated;

comment on function app.guard_last_admin(uuid) is
  'F012: refuses a change that would remove the last active admin from public.users. '
  'Takes a shared advisory lock first so concurrent set_user_role, set_user_active '
  '(and suspend_user through it) and delete_user calls serialize against each other '
  '(matrix §6 gap 7). Called only from within those SECURITY DEFINER bodies; granted '
  'to nobody directly, same as app.revoke_sessions.';
