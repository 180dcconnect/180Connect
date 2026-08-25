-- Migration: harden_decide_ownership_request_status_cast
-- Story: F020 Restricted Editing (#23, #454) — drive-by hardening
-- Spec: docs/audit-log-pattern.md §3 (reference RPC shape)
--
-- WHAT THIS IS: one defensive cast inside decide_ownership_request. Behaviour is
--   byte-for-byte identical on every path that already works.
--
-- WHY IT EXISTS: #454 found that decide_edit_suggestion (#451) crashed at runtime
--   with 42804 ("column status is of type edit_suggestion_status but expression is
--   of type text") when an untyped `case when p_approve then 'approved' else
--   'rejected' end` was written straight to the enum column — the unknown literals
--   resolved as text under some planning paths, and Postgres has no implicit
--   text->enum cast. decide_ownership_request does NOT have that bug: its case is
--   assigned into v_new_status (declared ownership_request_status), and assignment
--   coercion unknown->enum is reliable. But it relies on that indirection staying
--   put through future refactors; this migration makes the typing explicit so the
--   guarantee no longer depends on the variable's declaration.
--
-- WHY A NEW MIGRATION, NOT AN EDIT: 20260818120000 is applied to staging and
--   production — MIGRATIONS.md forbids editing applied migrations. Fix-forward.
--
-- Schema change approval record (SOP §7):
--   Change        | Replace body of decide_ownership_request(uuid, boolean, text).
--                 | Signature, return type, grants unchanged.
--   Reason        | Defensive parity with the 42804 fix in #454's
--                 | decide_edit_suggestion rewrite.
--   Compatibility | None — same statements with explicit literal casts.
--   Data migration| None.
--   Security      | Unchanged: SECURITY DEFINER, self-checks app.is_admin(),
--                 | row lock, audit_log in-transaction, grants untouched.
--   Documentation | None beyond this header.
--
-- Reversibility: paired rollback in ../rollback/20260822160400_harden_decide_ownership_request_status_cast.down.sql

create or replace function public.decide_ownership_request(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_request    public.ownership_requests%rowtype;
  v_live_owner uuid;
  v_new_status public.ownership_request_status;
begin
  if not app.is_admin() then
    raise exception 'only an admin may decide an ownership request'
      using errcode = '42501';
  end if;

  select * into v_request
    from public.ownership_requests
   where id = p_request_id
     for update;

  if v_request.id is null then
    raise exception 'ownership request % not found', p_request_id
      using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'ownership request % has already been decided', p_request_id
      using errcode = '55000';
  end if;

  -- Explicit casts: see header — same 42804 class as decide_edit_suggestion #454.
  v_new_status := case when p_approve
                       then 'approved'::public.ownership_request_status
                       else 'rejected'::public.ownership_request_status end;

  update public.ownership_requests
     set status        = v_new_status,
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = p_note
   where id = p_request_id;

  if p_approve then
    select owner_id into v_live_owner
      from public.organisations
     where id = v_request.organisation_id;

    -- The client may have moved while the request sat pending — including to the
    -- requester. reassign_ownership skips a no-op move, but calling it at all would
    -- still need a reason string for a handover that isn't happening, so the check is
    -- here. The request is still marked approved: the admin agreed, and the outcome
    -- the CAM asked for is the outcome they have.
    if v_live_owner is distinct from v_request.requested_by then
      -- Delegated, not reimplemented: this is the same audited path F163's assign form
      -- uses, so the client's open actions travel with it and F186's change history
      -- gets its usual 'ownership_assigned' row (matrix §3.11). It re-checks
      -- app.is_admin() on its own — the caller here is the deciding admin.
      perform public.reassign_ownership(
        array[v_request.organisation_id],
        v_request.requested_by,
        'Ownership request approved: ' || v_request.reason,
        null
      );
    end if;
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_approve then 'ownership_request_approved' else 'ownership_request_rejected' end,
    'organisations', v_request.organisation_id,
    jsonb_build_object(
      'request_id',   p_request_id,
      'requested_by', v_request.requested_by,
      'note',         p_note
    )
  );
end;
$$;

comment on function public.decide_ownership_request(uuid, boolean, text) is
  '#408: admin approves or rejects a pending ownership request. Approval delegates the '
  'move to reassign_ownership in the same transaction, so the handover is audited and '
  'the outgoing owner''s open actions travel with the client. Status literals are '
  'explicitly cast (42804-hardening from #454). SECURITY DEFINER; self-checks '
  'app.is_admin() and refuses an already-decided request.';

revoke execute on function public.decide_ownership_request(uuid, boolean, text) from public;
revoke execute on function public.decide_ownership_request(uuid, boolean, text) from anon;
grant execute on function public.decide_ownership_request(uuid, boolean, text) to authenticated;
