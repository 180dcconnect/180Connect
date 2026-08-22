-- Migration: create_ownership_requests
-- Sequence step 21.4 (addition to the Data Model migration sequence, appended after
--   step 21.3 create_suppressions rather than renumbered — steps 4-17 are still
--   unrun, same reason as create_suppressions and create_outreach_preferences).
-- Story: F165 follow-up — Request Client Ownership (admin-approved handover) (#408)
-- Spec: docs/rls-permission-matrix.md §3.16
--
-- WHY THIS EXISTS: F165's conflict warning tells a CAM that another CAM owns a client
--   and that they cannot proceed. Until now it dead-ended there — "ask an admin",
--   with no route in the product. This table is that route.
--
-- POLICY (decided by the Project Leader, 18 Aug 2026, on #406): a CAM NEVER overrides
--   another CAM's ownership. There is deliberately no "take anyway" path here, and
--   nothing in this migration relaxes claim_organisation's 55000 on an owned client
--   (20260806140000) or re-opens the direct owner_id write that
--   20260810110000_close_admin_owner_id_direct_write.sql closed. A request is a
--   request: it moves no ownership by itself and grants the requester no access they
--   did not already have. Only an admin's decision moves a client, and it moves it
--   through reassign_ownership — the same audited path F163's assign form uses.
--
-- WORKFLOW: pending (CAM requests) -> approved (admin agrees; ownership moves in the
--   same transaction) or rejected (admin declines; ownership untouched). No 'withdrawn'
--   state: the requester cancelling is not in #408's AC, and an unused enum value is a
--   one-way door in Postgres (create_suppressions header, SOP §7) — unlike 'lifted'
--   there, no committed AC needs it, so it is not reserved.
--
-- ONE OPEN REQUEST PER (CLIENT, REQUESTER): a partial unique index blocks a CAM
--   queueing the same ask twice. Two *different* CAMs may both want the same client,
--   and the admin should see both — so the index is per requester, not per
--   organisation (this is where it deliberately differs from
--   suppressions_one_open_per_org_idx, where a second open row would be meaningless).
--   Decided rows are kept, never overwritten: the history of who asked for what is the
--   point (#408 AC "historical context preserved").
--
-- WHY RPCs, NOT POLICIES: a required reason plus a role-gated state transition that
--   also moves ownership is MIGRATIONS.md's RLS recipe step 4 exactly. The table
--   grants no INSERT/UPDATE/DELETE to authenticated at all; every write goes through
--   request_client_ownership or decide_ownership_request, both SECURITY DEFINER, both
--   self-checking the caller's role, both writing audit_log in the same transaction
--   (docs/audit-log-pattern.md).
--
-- Schema change approval record (SOP §7):
--   Change        | Add OWNERSHIP_REQUESTS table + ownership_request_status enum;
--                 | add request_client_ownership and decide_ownership_request RPCs.
--   Reason        | #408 — F165's conflict warning needs a legitimate escalation path
--                 | that ends in an admin decision, not a CAM-side override.
--   Compatibility | New table and two new RPCs. Nothing existing changes: no policy is
--                 | widened, no grant added, reassign_ownership is called as-is.
--   Data migration| None.
--   Security      | RLS on. SELECT is narrow — admin, the requester, or the client's
--                 | current owner; a CAM cannot read who else is circling their
--                 | clients' neighbours. No INSERT/UPDATE/DELETE grant: writes are
--                 | SECURITY DEFINER RPCs that re-check the caller and audit.
--   Documentation | Data Model tab 04 (OWNERSHIP_REQUESTS) + tab 02 Data Dictionary +
--                 | tab 11 sequence step 21.4 — see #408 for the exact rows.
--
-- Reversibility: paired rollback in ../rollback/20260818120000_create_ownership_requests.down.sql

create type public.ownership_request_status as enum ('pending', 'approved', 'rejected');

create table public.ownership_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  requested_by      uuid not null references public.users (id),
  -- Owner at request time, snapshotted. The live owner can change while the request
  -- sits pending (an admin reassigns, the owner is offboarded), and the admin deciding
  -- it needs to see what the CAM was actually looking at when they asked.
  current_owner_id  uuid references public.users (id),
  status            public.ownership_request_status not null default 'pending',
  reason            text not null,
  decided_by        uuid references public.users (id),
  decided_at        timestamptz,
  decision_note     text,
  created_at        timestamptz not null default now(),

  constraint ownership_requests_reason_not_blank check (btrim(reason) <> ''),
  -- A CAM cannot ask for a client they already own; enforced in the RPC too, but the
  -- constraint means no write path can ever produce the row.
  constraint ownership_requests_not_self check (requested_by is distinct from current_owner_id),
  -- Decision fields travel together, same shape as suppressions_decision_consistent.
  constraint ownership_requests_decision_consistent check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

comment on table public.ownership_requests is
  '#408 (F165 follow-up): a CAM asks an admin to hand over a client another CAM owns. '
  'Pending until an admin decides; approval moves ownership via reassign_ownership. '
  'A CAM never overrides ownership directly — see migration header.';
comment on column public.ownership_requests.current_owner_id is
  'The owner when the request was made, not the live owner. Null only if the client '
  'became unowned between the check and the insert.';
comment on column public.ownership_requests.reason is
  'Required. Why this CAM should get the client — what the admin is deciding on.';
comment on column public.ownership_requests.decision_note is
  'Optional admin note on approval or rejection. Only the requester''s reason is '
  'mandatory.';

-- One open ask per CAM per client. Two different CAMs may both request the same
-- client; the admin sees both and decides.
create unique index ownership_requests_one_open_per_requester_idx
  on public.ownership_requests (organisation_id, requested_by)
  where status = 'pending';

-- The admin queue, and "everything about this client".
create index ownership_requests_pending_idx on public.ownership_requests (created_at)
  where status = 'pending';
create index ownership_requests_organisation_id_idx
  on public.ownership_requests (organisation_id);
create index ownership_requests_requested_by_idx
  on public.ownership_requests (requested_by);

-- Revoke before grant (MIGRATIONS.md §RLS recipe step 1). No INSERT/UPDATE/DELETE to
-- anyone: every write is a SECURITY DEFINER RPC below, same shape as suppressions.
revoke all on public.ownership_requests from anon, authenticated;
grant select on public.ownership_requests to authenticated;

alter table public.ownership_requests enable row level security;

-- Deliberately narrower than suppressions_select_active. A suppression is a fact about
-- a charity that the whole team needs in order to hide it; a request is between one
-- CAM, one owner, and the admins. Three readers: the admin who decides, the CAM who
-- asked (AC: they can see the outcome), and the current owner, who should know someone
-- is asking for their client rather than finding out when it moves.
create policy ownership_requests_select_involved on public.ownership_requests
  for select to authenticated
  using (
    app.is_active_user()
    and (
      app.is_admin()
      or requested_by = (select auth.uid())
      or app.owns_organisation(organisation_id)
    )
  );

-- ---------------------------------------------------------------------------
-- request_client_ownership — a CAM asks; nothing moves
-- ---------------------------------------------------------------------------

create or replace function public.request_client_ownership(
  p_organisation_id uuid,
  p_reason          text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_owner_id uuid;
  v_exists   boolean;
  v_id       uuid;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_cam() then
    -- Not a permission failure to be worked around: an admin already has
    -- reassign_ownership and would be requesting from themselves, and a viewer has no
    -- ownership at all.
    raise exception 'only a CAM can request a client; an admin can reassign one directly'
      using errcode = '42501';
  end if;

  if v_reason = '' then
    raise exception 'a reason is required so the admin can decide on the handover'
      using errcode = '23514';
  end if;

  select exists (select 1 from public.organisations where id = p_organisation_id)
    into v_exists;

  if not v_exists then
    raise exception 'organisation % not found', p_organisation_id
      using errcode = 'P0002';
  end if;

  select owner_id into v_owner_id
    from public.organisations
   where id = p_organisation_id;

  if v_owner_id is null then
    raise exception 'this client is unowned — claim it instead of requesting it'
      using errcode = '55000';
  end if;

  if v_owner_id = v_actor then
    raise exception 'you already own this client'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from public.ownership_requests
     where organisation_id = p_organisation_id
       and requested_by = v_actor
       and status = 'pending'
  ) then
    raise exception 'you already have a pending request for this client'
      using errcode = '23505';
  end if;

  insert into public.ownership_requests
    (organisation_id, requested_by, current_owner_id, reason)
  values
    (p_organisation_id, v_actor, v_owner_id, v_reason)
  returning id into v_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'ownership_requested', 'organisations', p_organisation_id,
    jsonb_build_object(
      'request_id',       v_id,
      'reason',           v_reason,
      'current_owner_id', v_owner_id
    )
  );

  return v_id;
end;
$$;

comment on function public.request_client_ownership(uuid, text) is
  '#408: a CAM asks an admin to hand over a client another CAM owns. Moves no '
  'ownership and grants no access — it inserts a pending row and audits the ask. '
  'SECURITY DEFINER because OWNERSHIP_REQUESTS grants no INSERT to authenticated; '
  'self-checks app.is_cam() and app.is_active_user().';

revoke execute on function public.request_client_ownership(uuid, text) from public;
revoke execute on function public.request_client_ownership(uuid, text) from anon;
grant execute on function public.request_client_ownership(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_ownership_request — admin only; approval is what moves the client
-- ---------------------------------------------------------------------------

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

  v_new_status := case when p_approve then 'approved' else 'rejected' end;

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
  'the outgoing owner''s open actions travel with the client. SECURITY DEFINER; '
  'self-checks app.is_admin() and refuses an already-decided request.';

revoke execute on function public.decide_ownership_request(uuid, boolean, text) from public;
revoke execute on function public.decide_ownership_request(uuid, boolean, text) from anon;
grant execute on function public.decide_ownership_request(uuid, boolean, text) to authenticated;
