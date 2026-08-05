-- Migration: unify_offboarding_reassignment
-- Sequence: addition (after create_reassign_ownership_rpc and create_deactivate_user_rpc).
-- Stories: F257 Reassign CAM When Offboarded + F014 Delete or Deactivate User.
-- Spec: docs/rls-permission-matrix.md §2, §3.11
--
-- THE DEFECT THIS FIXES:
--   F014's deactivate_user and F257's reassign_ownership were written in parallel and
--   both move organisations.owner_id. deactivate_user was written first, before
--   public.actions existed, and its own header says so — so it moves the departing
--   CAM's clients and leaves every open action still assigned to them. A deactivated
--   user fails app.is_active_user(), so those rows become invisible and unworkable to
--   everyone except an admin: the work is not deleted, it is stranded. That is exactly
--   the loss F257 exists to prevent, produced by the two features meeting.
--
--   They also wrote two different audit tokens for one event — 'ownership_reassigned'
--   (F014) and 'ownership_assigned' (F257) — so any history query had to know both.
--
-- THE SHAPE OF THE FIX:
--   One implementation, called from both places. deactivate_user keeps its signature,
--   its refusals and its transaction, and delegates the transfer itself.
--
--   That needs reassign_ownership to express something it previously could not: F014
--   offers a *release* path (p_release_clients) that returns clients to the unowned
--   pool, where any CAM may claim them. A null destination now means exactly that —
--   "reassign to nobody" — and open actions are unassigned rather than moved. Without
--   this, delegating would have silently dropped a path F014 already supports.
--
--   Token converges on 'ownership_reassigned': F014's is already merged, already in
--   the matrix, and already rendered by the F221 audit log page, so F257's is the one
--   that moves. detail keeps F014's `from`/`to`/`reason` keys so existing readers keep
--   working, and adds the F257 fields alongside.
--
-- Schema change approval record (SOP §7):
--   Change        | Replace reassign_ownership (null destination = release) and
--                 | deactivate_user (delegates instead of moving owner_id itself)
--   Reason        | Deactivation stranded every open action; two audit tokens for one event.
--   Compatibility | Both signatures unchanged. deactivate_user's return gains
--                 | actions_moved. Audit token for F257's path changes from
--                 | ownership_assigned to ownership_reassigned — no rows carry the old
--                 | token outside local test runs (staging has none: actions is empty
--                 | and /admin/offboard has never been used against it).
--   Data migration| None.
--   Security      | No privilege change. Both remain SECURITY DEFINER, admin self-checked.
--   Documentation | Matrix §2 and §3.11 updated.
--                 | Approved by Bashir (Project Leader), 3 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260804170000_unify_offboarding_reassignment.down.sql

create or replace function public.reassign_ownership(
  p_organisation_ids uuid[],
  p_new_owner_id     uuid,
  p_reason           text,
  p_from_user_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor         uuid := (select auth.uid());
  v_batch         uuid := gen_random_uuid();
  v_reason        text := trim(coalesce(p_reason, ''));
  v_new_owner     public.users%rowtype;
  v_org           record;
  v_orgs_moved    integer := 0;
  v_actions_moved integer := 0;
  v_skipped       integer := 0;
  v_this_actions  integer;
begin
  if not app.is_admin() then
    raise exception 'only an admin may reassign client ownership'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501', hint = 'inactive_actor';
  end if;

  if v_reason = '' then
    raise exception 'a reason is required so the handover can be understood later'
      using errcode = '22023', hint = 'reason_required';
  end if;

  if p_organisation_ids is null or cardinality(p_organisation_ids) = 0 then
    raise exception 'select at least one client to reassign'
      using errcode = '22023', hint = 'empty_selection';
  end if;

  -- A null destination is the release path (F014 p_release_clients): the clients go
  -- back to the unowned pool and their open actions are unassigned. Deliberately not
  -- an error — "move this to nobody" is a real instruction, distinct from omitting an
  -- argument, and the caller had to pass an explicit null to get here.
  if p_new_owner_id is not null then
    select * into v_new_owner from public.users where id = p_new_owner_id;

    if v_new_owner.id is null then
      raise exception 'the chosen user does not exist'
        using errcode = 'P0002', hint = 'destination_not_found';
    end if;

    if not v_new_owner.is_active then
      raise exception 'cannot reassign to a deactivated account'
        using errcode = '22023', hint = 'destination_not_eligible';
    end if;

    if v_new_owner.role not in ('cam', 'admin') then
      raise exception 'clients can only be owned by a CAM or an admin'
        using errcode = '22023', hint = 'destination_not_eligible';
    end if;
  end if;

  for v_org in
    select o.id, o.owner_id
      from public.organisations o
     where o.id = any(p_organisation_ids)
     order by o.id  -- deterministic lock order; two concurrent batches cannot deadlock
       for update
  loop
    if p_from_user_id is not null and v_org.owner_id is distinct from p_from_user_id then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_org.owner_id is not distinct from p_new_owner_id then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.organisations
       set owner_id = p_new_owner_id
     where id = v_org.id;

    -- Open work follows the client, including into the unowned pool, where it becomes
    -- unassigned rather than staying with someone who no longer owns the relationship.
    -- Completed and cancelled actions stay with whoever did them (matrix §3.11).
    with moved as (
      update public.actions
         set assignee_user_id = p_new_owner_id
       where organisation_id = v_org.id
         and status = 'open'
         and assignee_user_id is not distinct from coalesce(p_from_user_id, v_org.owner_id)
      returning 1
    )
    select count(*) into v_this_actions from moved;

    v_orgs_moved    := v_orgs_moved + 1;
    v_actions_moved := v_actions_moved + v_this_actions;

    -- `from`/`to`/`reason` are F014's key names, kept so anything already reading
    -- ownership_reassigned rows keeps working. The rest is F257's addition.
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      v_actor, 'ownership_reassigned', 'organisations', v_org.id,
      jsonb_build_object(
        'from',          v_org.owner_id,
        'to',            p_new_owner_id,
        'reason',        v_reason,
        'released',      p_new_owner_id is null,
        'trigger',       case when p_from_user_id is null then 'bulk_assign' else 'offboarding' end,
        'batch_id',      v_batch,
        'actions_moved', v_this_actions
      )
    );
  end loop;

  return jsonb_build_object(
    'batch_id',            v_batch,
    'organisations_moved', v_orgs_moved,
    'actions_moved',       v_actions_moved,
    'skipped',             v_skipped
  );
end;
$$;

comment on function public.reassign_ownership(uuid[], uuid, text, uuid) is
  'F257/F164/F253 and the transfer half of F014 deactivate_user: admin-only movement of '
  'client ownership with the outgoing owner''s open actions. A null p_new_owner_id '
  'releases to the unowned pool and unassigns those actions. SECURITY DEFINER — '
  'actions.assignee_user_id is granted to no one. Self-checks app.is_admin(), requires a '
  'reason, writes one ownership_reassigned audit row per client.';


-- ---------------------------------------------------------------------------
-- deactivate_user — unchanged except that the transfer is now delegated
-- ---------------------------------------------------------------------------
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

comment on function public.deactivate_user(uuid, text, uuid, boolean) is
  'F014: admin-only deactivation (offboarding). Refuses while the user owns clients '
  'unless given a destination — a new owner or the unowned pool — and moves them in the '
  'same transaction (AC2), delegating to reassign_ownership so the departing user''s '
  'open actions travel with their clients (F257). Sets is_active = false and '
  'deactivated_at; deletes nothing, so the audit trail survives (AC3, AC4). Requires a '
  'written reason (PRD §4.2). Accepted advisor exception — self-authorising RPC (§7).';
