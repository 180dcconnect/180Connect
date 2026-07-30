-- Migration: create_deactivate_user_rpc
-- Sequence: addition (after create_user_active_rpc; needs public.users,
--   public.organisations, app.is_admin, audit_log).
-- Story: F014 (#16) Delete or Deactivate User.
-- Spec: docs/rls-permission-matrix.md §2.1, §3.1; PRD §4.2, §6.12.
--
-- Schema change approval record (SOP §7):
--   Change        | Add USERS.deactivated_at (nullable timestamptz) + CHECK constraint;
--                 | add public.deactivate_user() RPC; replace public.set_user_active()
--                 | so reactivation clears the new column.
--   Reason        | F014 AC1 requires deactivation to be "a more permanent action than
--                 | suspension". F013 encodes both as is_active = false, so with one
--                 | flag the two states are byte-identical and the UI cannot tell them
--                 | apart. deactivated_at is the marker that distinguishes them.
--   Compatibility | Additive, nullable. Existing rows read as never-deactivated, which
--                 | is correct. No backfill. is_active keeps its exact meaning, so
--                 | every RLS policy, app.is_*() helper and the login check are
--                 | untouched.
--   Data migration| None.
--   Security      | Column granted to nobody (users' revoke-all still stands); written
--                 | only by the two SECURITY DEFINER RPCs below.
--   Documentation | Data Model tab 04 (USERS) + tab 02 (Data Dictionary).
--                 | Approved by Bashir (Project Leader), 30 Jul 2026.
--
-- WHY A MARKER COLUMN AND NOT AN account_status ENUM. The 29 Jul decision recorded in
--   create_user_active_rpc stands: is_active remains the single login gate. Every RLS
--   policy, app.is_admin(), app.is_active_user() and login.ts read that one boolean, so
--   there is exactly one place access is decided and no way for two fields to disagree
--   about whether someone may sign in — the failure mode that produces real auth holes.
--   An enum would mean rewriting all of those call sites, each rewrite a chance to
--   leave a gap. deactivated_at describes *which kind* of inactive this is; it never
--   decides access.
--
--   The enum-as-source-of-truth design (is_active as a GENERATED column derived from
--   it) is stronger on paper — the database itself would make divergence impossible.
--   It was rejected on migration risk, not on design: Postgres cannot add GENERATED to
--   an existing column, so is_active would have to be dropped and recreated, and the
--   policies that depend on it dropped and rebuilt, against a live database. The CHECK
--   constraint below buys most of that safety for none of that risk. Revisit if a
--   fourth or fifth lifecycle state ever appears; at two states, do not.
--
-- DEACTIVATION IS NOT DELETION (F014 AC3, AC4). No row is removed anywhere. The user's
--   audit_log rows stay attached to them, and audit_log.actor_user_id is ON DELETE SET
--   NULL precisely so the trail would survive even a real delete. There is deliberately
--   no hard-delete RPC in this migration and none should be added without a decision on
--   the data retention policy, which is still open.
--
-- A DEACTIVATED PERSON WHO REJOINS IS REACTIVATED, NOT RE-INVITED. Their row and its
--   email still exist, so a fresh invite to the same address collides with the auth
--   user. The invite flow (F008/F010) should detect an existing deactivated user and
--   offer reactivation instead. Not handled here — noted so it is not rediscovered.
--
-- Reversibility: paired rollback in ../rollback/20260730121500_create_deactivate_user_rpc.down.sql

alter table public.users
  add column deactivated_at timestamptz;

comment on column public.users.deactivated_at is
  'F014: when the account was deactivated (offboarded), null otherwise. Distinguishes '
  'deactivation from suspension — both are is_active = false, but only deactivation '
  'sets this. Never consulted for access decisions; is_active alone is the login gate.';

-- The two columns encode one state, so the nonsensical combination is forbidden by the
-- database rather than by convention. Without this, an active user could carry a
-- deactivation timestamp and the UI would have to guess which field to believe.
alter table public.users
  add constraint users_deactivated_at_matches_inactive
  check (deactivated_at is null or is_active = false);

-- ---------------------------------------------------------------------------
-- set_user_active: reactivation must clear the marker
-- ---------------------------------------------------------------------------
-- Fix-forward replacement rather than an edit to 20260729232004 (SOP §7: applied
-- migrations are never edited). Only the UPDATE statement differs from the version in
-- 20260729232500, which is the one this replaces — **not** 20260729232004.
--
-- CAREFUL: this is a `create or replace` of a function two earlier migrations already
-- define, so it silently wins. It must therefore carry forward everything they added,
-- and the one easy thing to drop is the `app.revoke_sessions` call that
-- 20260729232500 introduced — losing it would un-fix session revocation while every
-- test still passed except the one that seeds a session. Kept below, and asserted.
--
-- Without this, reactivating a *deactivated* user would set is_active = true while
-- deactivated_at stayed populated, which the constraint above rejects — reactivation
-- would fail outright with a constraint violation. Clearing it on the way back up is
-- what makes the reversal work, and it is correct on its own terms: an account that is
-- active again is not a deactivated account.
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

comment on function public.set_user_active(uuid, boolean) is
  'F013: admin-only suspend/reactivate. SECURITY DEFINER because users.is_active is '
  'granted to no one; self-checks app.is_admin() and writes an audit_log row. Cannot '
  'change your own access, which is also what keeps at least one active admin alive. '
  'F014: reactivation also clears deactivated_at, without which the '
  'users_deactivated_at_matches_inactive constraint would reject it. '
  'Accepted advisor exception — an intentional, self-authorising RPC (matrix §7).';

-- ---------------------------------------------------------------------------
-- deactivate_user
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE FUNCTION RATHER THAN A THIRD ARGUMENT TO set_user_active. The two
--   transitions have different preconditions (this one refuses to proceed while the
--   user owns clients), different required inputs (a written reason, a destination),
--   and different audit vocabulary. Folding them together would mean a function whose
--   arguments are only meaningful in some combinations, and "who was deactivated last
--   quarter" would become a jsonb filter instead of an action name.
--
-- REASSIGNMENT IS PART OF THE SAME TRANSACTION (F014 AC2). Deactivation and the
--   ownership transfer commit together or not at all. Doing them as two statements from
--   the route would allow a half-offboarded state — clients moved but the account still
--   live, or the account closed with its clients stranded on a user who can no longer
--   be selected as an assignee anywhere in the UI.
--
-- ORGANISATIONS ARE THE WHOLE SET, TODAY. F257 (Reassign CAM When Offboarded) also
--   covers tasks, drafts, reminders, pending actions and pipeline responsibilities.
--   None of those tables exist yet, so organisations.owner_id is currently the complete
--   set of things a departing CAM can own — which is why this function can satisfy
--   AC2 in full right now. When those tables land, F257 extends *this* function to
--   sweep them; the gate and the audit shape are meant to be built on, not replaced.
--
-- A WRITTEN REASON IS REQUIRED because PRD §4.2 lists ownership reassignment among the
--   privileged decisions that must carry one. It is stored on every audit row this
--   function writes, not just the user one, so reading the organisation's history alone
--   explains why its owner changed.
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

comment on function public.deactivate_user(uuid, text, uuid, boolean) is
  'F014: admin-only deactivation (offboarding). Refuses while the user owns clients '
  'unless given a destination — a new owner or the unowned pool — and moves them in '
  'the same transaction (AC2). Sets is_active = false and deactivated_at; deletes '
  'nothing, so the audit trail survives (AC3, AC4). Requires a written reason '
  '(PRD §4.2). Accepted advisor exception — a self-authorising RPC (matrix §7).';

-- anon can never call it; authenticated can (the body rejects non-admins). Revoke from
-- public AND anon explicitly: EXECUTE defaults to public on create, and Supabase also
-- default-grants execute to anon, which a public revoke alone does not remove.
revoke execute on function public.deactivate_user(uuid, text, uuid, boolean) from public;
revoke execute on function public.deactivate_user(uuid, text, uuid, boolean) from anon;
grant execute on function public.deactivate_user(uuid, text, uuid, boolean) to authenticated;
