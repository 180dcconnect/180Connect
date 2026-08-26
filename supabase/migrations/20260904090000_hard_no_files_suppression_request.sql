-- Migration: hard_no_files_suppression_request
-- Sequence: addition (needs public.organisations, public.suppressions, public.audit_log).
-- Story: F153 (#148) — Hard No Status, AC2: "Setting this status can trigger addition
--   to the suppression list (F248), consistent with the platform's Do-Not-Contact
--   protections."
-- Spec: supabase/migrations/20260806100000_create_suppressions.sql (the F251 flow);
--   docs/audit-log-pattern.md.
--
-- WHAT THIS CHANGES:
--   Moving a client to 'hard_no' now files a PENDING suppression request for that
--   organisation automatically. The admin-decides model is untouched: a CAM's Hard No
--   opens a pending row exactly like request_suppression does, and nothing blocks
--   outreach until an admin activates it. An admin setting Hard No also lands as
--   pending rather than active — deliberately. The status change and the suppression
--   are two different judgements ("this client firmly declined" vs "no one may contact
--   them again"), and F251 gives admins the decision on the second; auto-activating on
--   a status change would let a status write silently exercise the stronger power.
--
-- WHY A TRIGGER RATHER THAN EDITING THE TWO STATUS RPCs:
--   outreach_status can only change through set_outreach_status (single) or
--   set_outreach_status_bulk (batch) today, but a BEFORE UPDATE trigger covers both
--   without duplicating the filing logic into each body, plus any future writer
--   (e.g. a data-fix script). It stays inside the writing transaction, so the
--   suppression row and its audit_log entry commit or roll back with the status
--   change — the property docs/audit-log-pattern.md actually requires.
--
-- GUARDS, IN ORDER:
--   is_seed rows are skipped so `npm run seed` / `seed:clear` cycles never pile up
--   suppression requests against fake organisations (seed writes run as service_role,
--   which this trigger would otherwise see). An organisation that already has an OPEN
--   (pending or active) suppression gets no second row — the partial unique index
--   would reject it anyway; skipping keeps a Hard No from erroring the whole status
--   change. And a write with no attributable actor (auth.uid() unset AND the client
--   unowned) skips rather than inventing a requester: requested_by is NOT NULL and
--   naming a real person is the point of the column.
--
-- Schema change approval record (SOP §7):
--   Change        | Add BEFORE UPDATE trigger organisations_hard_no_suppression and
--                 | its function public.file_hard_no_suppression(). No table, column,
--                 | enum or policy changes; suppressions keeps its existing grants.
--   Reason        | F153 AC2. Soft No (F152 AC2) explicitly stays outside DNC — only
--                 | hard_no fires this.
--   Compatibility | Purely additive. Status changes to every other value behave
--                 | exactly as before. A Hard No on an organisation with an open
--                 | suppression succeeds as before instead of raising 23505 mid-RPC.
--   Data migration| None — no backfill of existing hard_no rows; those clients'
--                 | suppressions can be requested manually through the existing flow.
--   Security      | Function is SECURITY DEFINER with search_path pinned because it
--                 writes public.suppressions, which carries no INSERT grant for
--                 authenticated; it runs inside the caller's already-authorised
--                 status change and adds no reachable path on its own. Trigger
--                 cannot be invoked directly.
--   Documentation | docs/rls-permission-matrix.md §3.2 note added in the same PR.
--                 No Data Model tab change: no new table or field (SOP §7 scope).
--   Approved by   | Bashir (Project Manager), 26 Aug 2026 — "Auto pending request".
--
-- Reversibility: paired rollback in ../rollback/20260904090000_hard_no_files_suppression_request.down.sql

create or replace function public.file_hard_no_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Same actor resolution every other RPC here uses (set_outreach_status,
  -- request_suppression): auth.uid() from the caller's JWT.
  v_actor     uuid := auth.uid();
  v_actor_set boolean := v_actor is not null;
  v_org_owner uuid;
  v_is_seed   boolean;
  v_id        uuid;
begin
  select o.owner_id, o.is_seed into v_org_owner, v_is_seed
    from public.organisations o
   where o.id = new.id;

  -- Seed fixtures cycle statuses as service_role; suppressing fake charities would
  -- litter every staging demo with pending requests.
  if v_is_seed then
    return new;
  end if;

  -- Attribute the request to whoever made the status change; fall back to the
  -- client's owner when the write came from a context without a JWT (service role).
  v_actor := coalesce(v_actor, v_org_owner);
  if v_actor is null then
    return new;
  end if;

  -- One open (pending or active) suppression per organisation — skip rather than
  -- trip suppressions_one_open_per_org_idx and fail the status change itself.
  if exists (
    select 1 from public.suppressions s
     where s.organisation_id = new.id
       and s.status in ('pending', 'active')
  ) then
    return new;
  end if;

  insert into public.suppressions
    (organisation_id, status, reason, requested_by)
  values (
    new.id,
    'pending',
    'Client marked Hard No (F153). Filed automatically when their pipeline status changed to hard_no.',
    v_actor
  )
  on conflict (organisation_id) where status in ('pending', 'active') do nothing
  returning id into v_id;

  -- Only audit a request that actually landed (conflict-do-nothing returns null).
  if v_id is not null then
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      case when v_actor_set then v_actor end,
      'suppression_requested',
      'organisations',
      new.id,
      jsonb_build_object(
        'suppression_id', v_id,
        'reason', 'Client marked Hard No (F153). Filed automatically when their pipeline status changed to hard_no.',
        'trigger', 'hard_no_status'
      )
    );
  end if;

  return new;
end;
$$;

comment on function public.file_hard_no_suppression() is
  'F153 AC2: a transition to hard_no files a pending suppression request (admin still '
  'decides, per F251). Skips is_seed rows, organisations with an open suppression, and '
  'writes with no attributable actor. Fires inside the status-change transaction so '
  'row and audit entry commit together.';

revoke execute on function public.file_hard_no_suppression() from public;
revoke execute on function public.file_hard_no_suppression() from anon;

create trigger organisations_hard_no_suppression
  before update of outreach_status on public.organisations
  for each row
  when (new.outreach_status = 'hard_no' and old.outreach_status is distinct from 'hard_no')
  execute function public.file_hard_no_suppression();

comment on trigger organisations_hard_no_suppression on public.organisations is
  'F153 AC2: moving a client to Hard No auto-files a pending suppression request. '
  'See file_hard_no_suppression().';
