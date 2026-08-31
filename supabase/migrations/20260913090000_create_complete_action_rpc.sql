-- Migration: create_complete_action_rpc
-- Story: F171 Mark Action Complete (#173).
-- Spec: docs/rls-permission-matrix.md §3.11
--
-- WHAT THIS CLOSES: 20260801100000_create_actions.sql granted `authenticated`
--   plain column UPDATE on `status` and `completed_at` — completing an action
--   was, until now, an ordinary un-audited write, the same as editing its
--   title. F171 AC2 changes that requirement: completing an action must keep
--   "a record of it for audit purposes (F221)", and AC3 needs to show *who*
--   completed it, not only when. Neither AC can be met by a policy — a policy
--   cannot also insert into AUDIT_LOG (which grants no INSERT to
--   `authenticated` at all, docs/audit-log-pattern.md §2) and cannot capture
--   "the person who ran this specific statement" as a column value. So this
--   migration closes the direct-UPDATE door on `status`/`completed_at` the
--   same way `assignee_user_id` was already closed at creation, and reopens it
--   only through `complete_action`, an audited SECURITY DEFINER RPC — exactly
--   the MIGRATIONS.md convention 4 pattern (`set_user_role`, `set_user_active`).
--
-- WHY completed_by_user_id IS A NEW COLUMN, NOT INFERRED FROM assignee_user_id:
--   AC1 scopes CAM self-completion to "an action assigned to them", but
--   `actions_update_admin` already lets an admin update any action's status
--   directly — closing the plain-UPDATE door without an equivalent admin path
--   in the RPC would be a real capability regression, not just an audit
--   improvement. So `complete_action` allows the assignee OR an admin, which
--   means the completer is not always the assignee, and "who completed it"
--   (AC3) needs its own column rather than reading assignee_user_id and
--   guessing right only in the common case.
--
-- WHAT THIS DOES NOT DO: cancelling an action (the other `open` exit) is not
--   this ticket's AC and gets no RPC here. `status`/`completed_at` are simply
--   ungranted for direct UPDATE now, for every transition, so a future
--   "cancel" story needs its own audited RPC too — this is a closed door for
--   all of `status`, not a completion-shaped hole punched through it.
--
-- Schema change approval record (SOP §7):
--   Change        | Add ACTIONS.completed_by_user_id (nullable, FK users, set
--                 | null). Revoke `authenticated` UPDATE on ACTIONS.status and
--                 | ACTIONS.completed_at. Add complete_action(action_id) RPC.
--   Reason        | F171 AC2 (audit trail) and AC3 (who completed it) — see
--                 | above.
--   Compatibility | Additive column; narrows an existing grant (status/
--                 | completed_at direct UPDATE) that no shipped feature uses
--                 | yet — this branch has no "mark complete" UI before this
--                 | migration, so nothing regresses.
--   Data migration| None. Existing completed rows (seed data only, if any)
--                 | keep completed_by_user_id null — "completed before this
--                 | column existed", per its own column comment.
--   Security      | RLS unchanged (ACTIONS keeps actions_select_active/
--                 | actions_update_assignee/actions_update_admin as-is — the
--                 | narrower column grant is what actually closes the door).
--                 | complete_action is SECURITY DEFINER, self-checks the
--                 | caller is the assignee or an admin, requires the action be
--                 | `open`, and writes `audit_log` (`action_completed`) in the
--                 | same transaction.
--   Documentation | Matrix §3.11 updated alongside this migration.
--
-- Reversibility: paired rollback in
-- ../rollback/20260913090000_create_complete_action_rpc.down.sql

alter table public.actions
  add column completed_by_user_id uuid references public.users (id) on delete set null;

comment on column public.actions.completed_by_user_id is
  'Who marked this action complete (F171 AC3) — set only by complete_action, '
  'alongside completed_at, in the same statement. Null for an action that was '
  'never completed, or one completed before this column existed.';

-- Same effect on completed_at consistency as the table's own
-- actions_completed_at_matches_status check: a completed_by with no
-- completed_at (or the reverse) would mean the two drifted, which only a
-- direct write outside complete_action could cause now that this constraint
-- exists.
alter table public.actions
  add constraint actions_completed_by_matches_completed_at
    check ((completed_by_user_id is not null) <= (completed_at is not null));

-- Closes the direct-write door (see migration header) — every status
-- transition now goes through an RPC. complete_action is the only one that
-- exists today; a future cancel story adds its own.
revoke update (status, completed_at) on public.actions from authenticated;

create or replace function public.complete_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_action public.actions%rowtype;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active' using errcode = '42501';
  end if;

  select * into v_action from public.actions where id = p_action_id for update;

  if v_action.id is null then
    raise exception 'action % not found', p_action_id using errcode = 'P0002';
  end if;

  -- AC1: the assignee completes their own work. Admin included, matching the
  -- reach actions_update_admin already had before this migration closed the
  -- direct path — see header.
  if not (app.is_admin() or coalesce(v_action.assignee_user_id = v_actor, false)) then
    raise exception 'only the assignee or an admin can complete this action'
      using errcode = '42501';
  end if;

  if v_action.status <> 'open' then
    raise exception 'this action is not open' using errcode = '55000';
  end if;

  update public.actions
     set status = 'completed',
         completed_at = now(),
         completed_by_user_id = v_actor
   where id = p_action_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'action_completed', 'actions', p_action_id,
    jsonb_build_object(
      'organisation_id', v_action.organisation_id,
      'title', v_action.title,
      'assignee_user_id', v_action.assignee_user_id
    )
  );
end;
$$;

comment on function public.complete_action(uuid) is
  'F171: marks an open action completed — assignee or admin only, self-checked. '
  'Sets completed_at/completed_by_user_id and writes audit_log (action_completed) '
  'in the same transaction. SECURITY DEFINER because ACTIONS.status/completed_at '
  'carry no direct UPDATE grant to authenticated (see migration header).';

revoke execute on function public.complete_action(uuid) from public, anon;
grant execute on function public.complete_action(uuid) to authenticated;
