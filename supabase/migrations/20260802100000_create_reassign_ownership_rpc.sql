-- Migration: create_reassign_ownership_rpc
-- Sequence: addition (after create_actions; needs public.organisations, public.actions,
--   public.audit_log, app.is_admin). Not a numbered step — RPC-only migrations are not
--   rows in Data Model tab 11, following create_user_role_rpc (F012).
-- Stories: F257 Reassign CAM When Offboarded (primary), F164 Change Client Owner,
--   F253 Bulk Assign Client Owner (reuses reassign_ownership with an arbitrary selection).
-- Spec: docs/rls-permission-matrix.md §3.11
--
-- WHY AN RPC AND NOT A POLICY:
--   Reassignment is a reason-carrying write. F257 requires an audit_log row naming the
--   outgoing CAM, the incoming CAM and why — and no RLS policy can compel a caller to
--   supply a reason or to write the audit row in the same transaction. So the write path
--   is a function: actions.assignee_user_id is granted to nobody (create_actions), and
--   organisations.owner_id, though policy-writable for a CAM's own claim (F162), is
--   moved *between* two other people only here.
--
-- WHY ONE FUNCTION SERVES F257 AND F253:
--   Both are "move these organisations to this CAM". F257 passes everything the
--   offboarded CAM owns; F253 passes a hand-picked selection. Two functions would mean
--   two audit shapes and two sets of permission tests, and F186's change history would
--   have to render both. p_from_user_id is what separates them — see below.
--
-- Schema change approval record (SOP §7):
--   Change        | Add reassign_ownership() and reassign_actions() SECURITY DEFINER RPCs
--   Reason        | F257 acceptance: admins reassign client work without developer
--                 | intervention, and every move is audited.
--   Compatibility | New functions. No table or column changes. No data migration.
--   Security      | SECURITY DEFINER, search_path pinned, self-checks app.is_admin().
--                 | EXECUTE revoked from public and anon, granted to authenticated.
--   Documentation | Matrix §3.11. No Data Model tab change — no schema object added.
--                 | Approved by Bashir (Project Leader), 2 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260802100000_create_reassign_ownership_rpc.down.sql


-- ---------------------------------------------------------------------------
-- reassign_ownership — move clients, and the open work that goes with them
-- ---------------------------------------------------------------------------
-- p_from_user_id is optional and does two jobs when supplied:
--
--   1. It is a concurrency guard. The offboarding screen computes "everything CAM X
--      owns", then the admin confirms some seconds later. If ownership moved in
--      between — another admin acted, or the CAM handed a client over themselves —
--      naming the expected owner means the stale rows are skipped rather than
--      silently seized. Without it the screen's snapshot would overwrite whatever
--      the truth had become.
--   2. It selects whose actions move. On an org changing hands, only the outgoing
--      owner's open actions follow; work an admin assigned to a *third* CAM on that
--      client stays with them, because that CAM is not the one leaving.
--
-- When null (the F253 bulk-assign path) each organisation's current owner plays the
-- part of the outgoing owner, per row.
--
-- NOT COVERED, deliberately: actions assigned to the offboarded CAM on clients they do
-- not own (F169 admin-assigned work). Those cannot be found from a list of organisation
-- ids without also seizing clients belonging to other CAMs. reassign_actions() below is
-- the second half; the offboarding screen calls both.
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
  -- Authorisation, re-checked inside the definer boundary: SECURITY DEFINER has already
  -- bypassed the RLS that would otherwise stop a non-admin reaching these rows.
  if not app.is_admin() then
    raise exception 'only an admin may reassign client ownership'
      using errcode = '42501';
  end if;

  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  -- The reason is the point of the RPC. An empty one would leave an audit trail that
  -- records the move but not why it happened, which is what F257 asks for.
  if v_reason = '' then
    raise exception 'a reason is required so the handover can be understood later'
      using errcode = '22023';
  end if;

  if p_organisation_ids is null or cardinality(p_organisation_ids) = 0 then
    raise exception 'select at least one client to reassign'
      using errcode = '22023';
  end if;

  select * into v_new_owner from public.users where id = p_new_owner_id;

  if v_new_owner.id is null then
    raise exception 'the chosen user does not exist'
      using errcode = 'P0002';
  end if;

  -- Handing clients to someone who cannot sign in, or to a viewer who cannot act on
  -- them, loses the work just as surely as leaving them with the person who left.
  if not v_new_owner.is_active then
    raise exception 'cannot reassign to a deactivated account'
      using errcode = '22023';
  end if;

  if v_new_owner.role not in ('cam', 'admin') then
    raise exception 'clients can only be owned by a CAM or an admin'
      using errcode = '22023';
  end if;

  for v_org in
    select o.id, o.owner_id
      from public.organisations o
     where o.id = any(p_organisation_ids)
     order by o.id  -- deterministic lock order; two concurrent batches cannot deadlock
       for update
  loop
    -- Skipped rather than failed, and counted so the caller can say so. A batch that
    -- aborts because one row moved in the meantime is worse than one that reports it:
    -- the admin would have to work out which of fifty clients was the problem.
    if p_from_user_id is not null and v_org.owner_id is distinct from p_from_user_id then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Already where it is being sent. Not audited: the trail records real transitions,
    -- as in set_user_role.
    if v_org.owner_id is not distinct from p_new_owner_id then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.organisations
       set owner_id = p_new_owner_id
     where id = v_org.id;

    -- Only open work follows the client. A completed or cancelled action is a record of
    -- what the previous CAM did, and reassigning it would rewrite that history — the
    -- same reason note and draft authorship stay put (matrix §3.11).
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

    -- One row per client, not one per batch: F186 (View Client Change History) and the
    -- client timeline both read by target_id, and a single batch row would be invisible
    -- on every client it touched. batch_id ties them back together for the admin view.
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      v_actor, 'ownership_assigned', 'organisations', v_org.id,
      jsonb_build_object(
        'from_user_id',  v_org.owner_id,
        'to_user_id',    p_new_owner_id,
        'reason',        v_reason,
        'source',        case when p_from_user_id is null then 'bulk_assign' else 'offboarding' end,
        'batch_id',      v_batch,
        'actions_moved', v_this_actions
      )
    );
  end loop;

  return jsonb_build_object(
    'batch_id',             v_batch,
    'organisations_moved',  v_orgs_moved,
    'actions_moved',        v_actions_moved,
    'skipped',              v_skipped
  );
end;
$$;

comment on function public.reassign_ownership(uuid[], uuid, text, uuid) is
  'F257/F164/F253: admin-only transfer of client ownership, with the outgoing owner''s '
  'open actions. SECURITY DEFINER — actions.assignee_user_id is granted to no one. '
  'Self-checks app.is_admin(), requires a reason, and writes one audit_log row per '
  'client. p_from_user_id guards against a stale selection and scopes which actions '
  'move. Returns a jsonb summary including a skipped count.';


-- ---------------------------------------------------------------------------
-- reassign_actions — the work that ownership alone does not reach
-- ---------------------------------------------------------------------------
-- The other half of an offboarding. An admin can assign a CAM work on a client someone
-- else owns (F169); reassign_ownership cannot move those, because they are not found by
-- naming organisations. This takes the action ids directly.
create or replace function public.reassign_actions(
  p_action_ids      uuid[],
  p_new_assignee_id uuid,
  p_reason          text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_batch        uuid := gen_random_uuid();
  v_reason       text := trim(coalesce(p_reason, ''));
  v_new_assignee public.users%rowtype;
  v_action       record;
  v_moved        integer := 0;
  v_skipped      integer := 0;
begin
  if not app.is_admin() then
    raise exception 'only an admin may reassign actions'
      using errcode = '42501';
  end if;

  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if v_reason = '' then
    raise exception 'a reason is required so the handover can be understood later'
      using errcode = '22023';
  end if;

  if p_action_ids is null or cardinality(p_action_ids) = 0 then
    raise exception 'select at least one action to reassign'
      using errcode = '22023';
  end if;

  select * into v_new_assignee from public.users where id = p_new_assignee_id;

  if v_new_assignee.id is null then
    raise exception 'the chosen user does not exist'
      using errcode = 'P0002';
  end if;

  if not v_new_assignee.is_active then
    raise exception 'cannot reassign to a deactivated account'
      using errcode = '22023';
  end if;

  if v_new_assignee.role not in ('cam', 'admin') then
    raise exception 'actions can only be assigned to a CAM or an admin'
      using errcode = '22023';
  end if;

  for v_action in
    select a.id, a.assignee_user_id, a.organisation_id, a.status
      from public.actions a
     where a.id = any(p_action_ids)
     order by a.id
       for update
  loop
    -- Closed work is history and stays with whoever did it; an action already held by
    -- the incoming CAM is a no-op. Both are counted, neither is audited.
    if v_action.status <> 'open'
       or v_action.assignee_user_id is not distinct from p_new_assignee_id then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.actions
       set assignee_user_id = p_new_assignee_id
     where id = v_action.id;

    v_moved := v_moved + 1;

    -- target_table is 'actions' here, and the client is carried in detail so the
    -- timeline on that client can still surface the handover (F257: "linked to the
    -- correct client").
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      v_actor, 'action_reassigned', 'actions', v_action.id,
      jsonb_build_object(
        'from_user_id',    v_action.assignee_user_id,
        'to_user_id',      p_new_assignee_id,
        'organisation_id', v_action.organisation_id,
        'reason',          v_reason,
        'source',          'offboarding',
        'batch_id',        v_batch
      )
    );
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch,
    'actions_moved', v_moved,
    'skipped', v_skipped
  );
end;
$$;

comment on function public.reassign_actions(uuid[], uuid, text) is
  'F257: admin-only transfer of open actions by id — the F169 admin-assigned work that '
  'reassign_ownership cannot reach, because it sits on clients the offboarded CAM does '
  'not own. Writes one audit_log row per action, carrying organisation_id so the client '
  'timeline can show it.';


-- EXECUTE defaults to public on create, and Supabase also default-grants it to anon;
-- a revoke from public alone does not remove the anon grant. Both functions self-check
-- app.is_admin(), so authenticated is the correct grantee (matrix §7).
revoke execute on function public.reassign_ownership(uuid[], uuid, text, uuid) from public;
revoke execute on function public.reassign_ownership(uuid[], uuid, text, uuid) from anon;
grant  execute on function public.reassign_ownership(uuid[], uuid, text, uuid) to authenticated;

revoke execute on function public.reassign_actions(uuid[], uuid, text) from public;
revoke execute on function public.reassign_actions(uuid[], uuid, text) from anon;
grant  execute on function public.reassign_actions(uuid[], uuid, text) to authenticated;
