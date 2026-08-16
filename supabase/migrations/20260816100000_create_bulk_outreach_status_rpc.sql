-- F064 (#66) — Bulk Update Status.
--
-- One RPC that moves many clients to one pipeline status in a single transaction.
--
-- WHY A SECOND RPC RATHER THAN CALLING set_outreach_status IN A LOOP:
--   The obvious implementation — the browser POSTing to /api/clients/[id]/status
--   once per selected client — is N HTTP round trips and N independent
--   transactions. Half of them can commit and half fail, leaving the CAM looking
--   at a list that is partly updated with no way to tell which half, and the
--   audit trail recording a change that the user experienced as a failure. F064's
--   issue notes the feature "could be dangerous if misused"; a half-applied bulk
--   write is exactly that danger. This function is all-or-nothing: every selected
--   client moves, or none does and the CAM sees why.
--
-- PERMISSION RULE (F064's "Blocked By: bulk update permission rules"):
--   Identical to the single-client path — the client's owner (CAM) or an admin.
--   Deliberately not a new rule: a bulk action that could change a client a CAM
--   is not allowed to change one at a time would be a privilege escalation
--   dressed as a convenience. Because the batch is atomic, one unowned client in
--   the selection fails the whole call rather than being silently skipped —
--   silently skipping is how a CAM comes to believe a client moved when it did
--   not. The list UI disables the checkbox on rows the actor cannot change, so
--   this exception is a backstop against a crafted request, not the normal path.
--
-- NO-OPS:
--   A selected client that is already on the target status is not written and not
--   audited (docs/audit-log-pattern.md §5, same convention as set_outreach_status
--   and set_user_role). The return value reports how many were skipped so the UI
--   can say "12 updated, 3 already on that status" rather than claiming 15 moves.
--
-- BATCH CEILING:
--   500 per call. Not a performance limit — it is the blast radius. Selecting the
--   whole filtered list on a large seeded dataset and mis-clicking a status is the
--   misuse F064 warns about, and a cap turns an unbounded accident into a bounded
--   one. The UI never sends more (it selects by page), so hitting this means
--   something built a request by hand.
--
-- Schema change approval record (SOP §7):
--   Change        | Add set_outreach_status_bulk(uuid[], outreach_status)
--                 | SECURITY DEFINER RPC. No table, column, enum or policy
--                 | changes — the pipeline status column, its value set and its
--                 | grants are exactly as F145 left them.
--   Reason        | F064 AC1 (one action moves every selected client),
--                 | AC2 (a confirmation step needs a count it can trust, which
--                 | means the count and the write must agree — an atomic call),
--                 | AC3 (cannot set an invalid status: the parameter is the
--                 | public.outreach_status enum, so an undefined value is
--                 | rejected by Postgres before the body runs).
--   Compatibility | Purely additive. set_outreach_status is untouched and remains
--                 | the single-client path used by /clients/[id]. Nothing reads
--                 | or writes outreach_status differently as a result. The
--                 | audit_log rows this writes use the existing 'status_changed'
--                 | action token, so the admin audit page needs no change and
--                 | existing filters keep matching.
--   Data migration| None. No backfill, no data touched at migration time.
--   Security      | SECURITY DEFINER, search_path pinned, re-checks is_active_user
--                 | and owner-or-admin per row inside the body. EXECUTE revoked
--                 | from public/anon, granted to authenticated. Direct UPDATE on
--                 | organisations.outreach_status stays revoked (F145), so this
--                 | opens no new write path — it batches an existing one.
--   Documentation | docs/rls-permission-matrix.md §2/§3.2 updated in the same PR.
--                 | No Data Model change: no table or field is added or altered,
--                 | so tabs 02/04 are unaffected (SOP §7 covers schema shape; a
--                 | function that writes an existing column through an existing
--                 | rule adds no field to document).
--   Approved by   | Bashir (Project Leader), 16 Aug 2026.
--
-- Reversibility: paired rollback in
--   ../rollback/20260816100000_create_bulk_outreach_status_rpc.down.sql

create or replace function public.set_outreach_status_bulk(
  p_organisation_ids uuid[],
  p_new_status public.outreach_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := (select auth.uid());
  v_ids       uuid[];
  v_requested int;
  v_found     int;
  v_denied    int;
  v_changed   int;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  -- Duplicates and nulls are the caller's problem to not send, but they are also
  -- harmless to absorb: deduping here means the count reported back matches the
  -- number of distinct clients affected, which is the number AC2's confirmation
  -- step showed the CAM.
  select coalesce(array_agg(distinct candidate), '{}'::uuid[])
    into v_ids
    from unnest(coalesce(p_organisation_ids, '{}'::uuid[])) as candidate
   where candidate is not null;

  v_requested := coalesce(array_length(v_ids, 1), 0);

  -- F064 testing notes: "zero selected records". An empty selection is a mistake,
  -- not a no-op to swallow silently — the CAM pressed apply expecting something.
  if v_requested = 0 then
    raise exception 'select at least one client before changing status'
      using errcode = '22023';
  end if;

  if v_requested > 500 then
    raise exception 'a bulk status change covers at most 500 clients at once'
      using errcode = '22023';
  end if;

  -- Lock every target row up front, ordered by id. The order is what stops two
  -- concurrent bulk updates over overlapping selections from deadlocking by
  -- taking the same rows in opposite orders; the lock itself is what makes the
  -- permission check below and the write beneath it describe the same rows.
  select count(*)
    into v_found
    from (
      select o.id
        from public.organisations o
       where o.id = any(v_ids)
       order by o.id
         for update
    ) locked;

  if v_found <> v_requested then
    raise exception 'one or more of those clients could not be found'
      using errcode = 'P0002';
  end if;

  -- Same rule as set_outreach_status, applied to the whole batch: owner or admin.
  -- Reported as a count, never as a list of names — the caller already knows
  -- which clients it selected, and naming rows back at a request that was
  -- refused would hand a crafted call a way to probe ownership.
  if not app.is_admin() then
    select count(*)
      into v_denied
      from public.organisations o
     where o.id = any(v_ids)
       and o.owner_id is distinct from v_actor;

    if v_denied > 0 then
      raise exception 'you can only change the status of clients you own (% of % selected are not yours)',
        v_denied, v_requested
        using errcode = '42501';
    end if;
  end if;

  -- One statement, so the audit rows are written from the same snapshot the
  -- update reads: `snapshot` sees pre-update values even though `updated` runs in
  -- the same statement, which is how `from` stays the status the client was
  -- actually on. Rows already on the target status never enter `snapshot`, so
  -- they are neither written nor audited.
  with snapshot as (
    select o.id, o.outreach_status as from_status
      from public.organisations o
     where o.id = any(v_ids)
       and o.outreach_status is distinct from p_new_status
  ),
  updated as (
    update public.organisations o
       set outreach_status = p_new_status
      from snapshot s
     where o.id = s.id
    returning o.id
  ),
  audited as (
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    select
      v_actor,
      'status_changed',
      'organisations',
      s.id,
      jsonb_build_object(
        'from', s.from_status,
        'to', p_new_status,
        -- Marks the row as part of a batch without inventing a second action
        -- token: 'trigger' is the existing key for "what caused this", already
        -- carrying 'self_claim' and 'bulk_assign' elsewhere in the trail.
        'trigger', 'bulk_update',
        'batch_size', v_requested
      )
      from snapshot s
    returning 1
  )
  select count(*) into v_changed from updated;

  return jsonb_build_object(
    'requested', v_requested,
    'changed', v_changed,
    'unchanged', v_requested - v_changed
  );
end;
$$;

comment on function public.set_outreach_status_bulk(uuid[], public.outreach_status) is
  'F064: moves every named client to one pipeline status in a single transaction. '
  'Same permission rule as F145''s set_outreach_status (the client''s owner or an '
  'admin), enforced across the whole batch — one client the caller does not own '
  'fails the entire call rather than being skipped. Clients already on the target '
  'status are not written and not audited. Capped at 500 clients per call. Returns '
  '{requested, changed, unchanged}.';

revoke execute on function public.set_outreach_status_bulk(uuid[], public.outreach_status) from public;
revoke execute on function public.set_outreach_status_bulk(uuid[], public.outreach_status) from anon;
grant execute on function public.set_outreach_status_bulk(uuid[], public.outreach_status) to authenticated;
