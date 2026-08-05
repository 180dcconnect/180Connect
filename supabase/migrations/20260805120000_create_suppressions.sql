-- Migration: create_suppressions
-- Sequence step 21.1 (addition to the Data Model migration sequence, appended after
--   step 21.0 create_outreach_preferences rather than renumbered — steps 4-17 are
--   still unrun, same reason as that migration and create_user_onboarding).
-- Story: F251 Suppress Charity Record (#82)
-- Spec: docs/rls-permission-matrix.md §3.14
--
-- SCOPE: this is the F251 acceptance criteria only — a CAM can request a charity be
--   suppressed, an admin decides it, and once active it hides the record from the
--   active working list and blocks outreach. It is deliberately NOT the
--   `email_hash`/`phone_hash` GDPR objection list described in
--   docs/data-lifecycle-policy.md §7 (that is contact-level, permanent, and serves
--   Art. 21 — a different story). This table's `organisation_id` column is the same
--   "suppress an organisation as well as a person" branch §7 anticipates, so a future
--   contact-level suppression story can extend this table (or sit beside it) rather
--   than starting over. Built ahead of F248 with the Project Leader's agreement
--   (5 Aug 2026) — F248 is "a suppression list exists," which this table already is;
--   there is no reason to block F251 on a separate ticket to build the same thing.
--
-- WHO CAN SUPPRESS (resolves the F251 "Blocked By / Open Questions" item, decided by
--   the Project Leader, 5 Aug 2026): only an admin can put a suppression into effect.
--   A CAM can request one (self-checked in request_suppression via app.can_write(),
--   which is admin-or-cam). An admin's own call to request_suppression skips the
--   pending state and lands directly on 'active' — an admin does not request
--   permission from themselves. This also resolves the contradiction in the original
--   ticket text ("owning CAM or admin can trigger" vs. the AC's "not executable by
--   non-admin users"): the CAM-visible action is *request*, not *suppress*.
--
-- WORKFLOW: pending (CAM request) -> active (admin approved) or rejected (admin
--   declined), via request_suppression / decide_suppression_request below. 'lifted'
--   is in the status enum now because F251's own AC ("...unless an admin explicitly
--   removes suppression") and Component Definition ("Links to F185") already commit
--   to it existing — adding an enum value later is a one-way door in Postgres
--   (SOP §7 / create_organisations precedent), so it is cheaper to reserve it now
--   than to negotiate a schema change later. The RPC that transitions active -> lifted
--   is F185's own (#181), not built here.
--
-- ONE OPEN SUPPRESSION PER ORGANISATION: a partial unique index blocks a second
--   pending/active row for the same organisation — no duplicate concurrent requests,
--   no double suppression. History (rejected / lifted rows) is kept, not overwritten,
--   same reasoning as NOTES/ACTIONS/AUDIT_LOG being append-style rather than mutated
--   in place.
--
-- WHY RPCs, NOT POLICIES: "reason required" + a role-gated state transition is exactly
--   the case MIGRATIONS.md's RLS recipe step 4 reserves for a SECURITY DEFINER RPC
--   (see override_outreach_status in docs/rls-permission-matrix.md §6, and
--   set_user_role for the worked example). The table itself grants no INSERT/UPDATE to
--   authenticated at all — every write goes through request_suppression or
--   decide_suppression_request, both of which self-check the caller's role and write
--   an audit_log row in the same transaction (docs/audit-log-pattern.md).
--
-- OUTREACH BLOCK (AC8): app.can_contact_organisation() — already the WITH CHECK on
--   OUTREACH_MESSAGES INSERT — is extended here to require NOT
--   app.organisation_is_suppressed(), so a suppressed organisation cannot be emailed
--   by anyone, admin included, until F185 lifts it. Re-declared via CREATE OR REPLACE
--   in this migration rather than editing 20260722103200_create_rls_helpers.sql, which
--   is already applied (MIGRATIONS.md: never edit an applied migration).
--
-- Schema change approval record (SOP §7):
--   Change        | Add SUPPRESSIONS table; extend app.can_contact_organisation to
--                 | check it; add app.organisation_is_suppressed.
--   Reason        | F251 — CAMs need to suppress a charity record with a required
--                 | reason and admin sign-off (#82).
--   Compatibility | New table. app.can_contact_organisation gains one more predicate
--                 | (AND NOT suppressed) — narrows an existing allow, cannot newly
--                 | permit anything that was previously blocked.
--   Data migration| None.
--   Security      | RLS on; SELECT all active users (needed to hide suppressed
--                 | records from the shared pipeline view); no INSERT/UPDATE/DELETE
--                 | grant — writes are SECURITY DEFINER RPCs only. Both RPCs re-check
--                 | the caller's role and write audit_log in the same transaction.
--   Documentation | Data Model tab 04 + tab 02 — owned directly by the Project Leader
--                 | for this change, not a TODO left in code (per 5 Aug 2026 agreement,
--                 | departs from the TODO-comment pattern used by the two migrations
--                 | above this one).
--
-- Reversibility: paired rollback in ../rollback/20260805120000_create_suppressions.down.sql

create type public.suppression_status as enum ('pending', 'active', 'rejected', 'lifted');

create table public.suppressions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  status          public.suppression_status not null default 'pending',
  reason          text not null,
  requested_by    uuid not null references public.users (id),
  decided_by      uuid references public.users (id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),

  constraint suppressions_reason_not_blank check (btrim(reason) <> ''),
  -- Decision fields travel together: a row is either still pending (both null) or has
  -- been decided (both set). Prevents 'active'/'rejected' with no record of who.
  constraint suppressions_decision_consistent check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

comment on table public.suppressions is
  'F251: charity suppression requests and decisions. CAM requests (status pending), '
  'admin decides (active/rejected); F185 (#181) lifts an active row. Not the '
  'contact-level GDPR suppression list from docs/data-lifecycle-policy.md §7 — see '
  'migration header.';
comment on column public.suppressions.reason is
  'Required at request time (F251 AC). Free text, not a structured code — unlike the '
  '§7 list, this is CAM-facing and never automated.';
comment on column public.suppressions.requested_by is
  'Who asked for it. Equal to decided_by when an admin suppresses directly (no '
  'pending step for their own request).';
comment on column public.suppressions.decision_note is
  'Optional admin note on approval/rejection. Not required — only the requester''s '
  '`reason` is mandatory per the AC.';

-- One open (pending or active) suppression per organisation at a time.
create unique index suppressions_one_open_per_org_idx on public.suppressions (organisation_id)
  where status in ('pending', 'active');

-- Admin's request queue, and "everything about this organisation".
create index suppressions_pending_idx on public.suppressions (created_at) where status = 'pending';
create index suppressions_organisation_id_idx on public.suppressions (organisation_id);

-- Revoke before grant (MIGRATIONS.md §RLS recipe step 1). No INSERT/UPDATE/DELETE grant
-- to anyone: every write is a SECURITY DEFINER RPC below, same shape as audit_log.
revoke all on public.suppressions from anon, authenticated;
grant select on public.suppressions to authenticated;

alter table public.suppressions enable row level security;

-- Shared read: every active user needs to know a record is suppressed to hide it from
-- the working list (AC1) and show status in the UI, same reasoning as
-- organisations_select_active.
create policy suppressions_select_active on public.suppressions
  for select to authenticated
  using (app.is_active_user());

-- ---------------------------------------------------------------------------
-- app.organisation_is_suppressed — new helper, same shape as app.owns_organisation
-- ---------------------------------------------------------------------------

create or replace function app.organisation_is_suppressed(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.suppressions
     where organisation_id = p_organisation_id
       and status = 'active'
  );
$$;

comment on function app.organisation_is_suppressed(uuid) is
  'F251: true while an admin-approved suppression is active for the organisation. '
  'Used by app.can_contact_organisation() to block outreach (AC8).';

revoke execute on function app.organisation_is_suppressed(uuid) from public;
grant execute on function app.organisation_is_suppressed(uuid) to authenticated, service_role;

-- Re-declare (CREATE OR REPLACE, not an edit to the applied migration) to add the
-- suppression check. Narrows the existing allow only — cannot newly permit anything.
create or replace function app.can_contact_organisation(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (
      app.is_admin()
      or (
        app.is_cam()
        and (
          app.owns_organisation(p_organisation_id)
          or app.organisation_is_unowned(p_organisation_id)
        )
      )
    )
    and not app.organisation_is_suppressed(p_organisation_id);
$$;

comment on function app.can_contact_organisation(uuid) is
  'PRD 4.3: admin may contact any organisation; a CAM may contact one they own or one '
  'nobody owns; a CAM may never contact another CAM''s organisation. F251: blocked '
  'entirely, admin included, while a suppression is active — lifting it (F185) is the '
  'only way back in. Use as the WITH CHECK on OUTREACH_MESSAGES INSERT.';

-- ---------------------------------------------------------------------------
-- request_suppression — CAM requests, admin's own call takes effect immediately
-- ---------------------------------------------------------------------------

create or replace function public.request_suppression(
  p_organisation_id uuid,
  p_reason          text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_status public.suppression_status;
  v_id     uuid;
begin
  if not app.can_write() then
    raise exception 'only an active admin or CAM may request suppression'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to suppress a charity record'
      using errcode = '23514';
  end if;

  if not exists (select 1 from public.organisations where id = p_organisation_id) then
    raise exception 'organisation % not found', p_organisation_id
      using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.suppressions
     where organisation_id = p_organisation_id
       and status in ('pending', 'active')
  ) then
    raise exception 'organisation % already has an open suppression request', p_organisation_id
      using errcode = '23505';
  end if;

  -- An admin's own request is a suppression, not a request for one.
  v_status := case when app.is_admin() then 'active' else 'pending' end;

  insert into public.suppressions
    (organisation_id, status, reason, requested_by, decided_by, decided_at)
  values (
    p_organisation_id,
    v_status,
    p_reason,
    v_actor,
    case when v_status = 'active' then v_actor else null end,
    case when v_status = 'active' then now() else null end
  )
  returning id into v_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when v_status = 'active' then 'suppression_approved' else 'suppression_requested' end,
    'organisations', p_organisation_id,
    jsonb_build_object('suppression_id', v_id, 'reason', p_reason)
  );

  return v_id;
end;
$$;

comment on function public.request_suppression(uuid, text) is
  'F251: admin or CAM requests a charity be suppressed. Admin''s own request lands '
  'directly on active (self-approved); a CAM''s lands pending, awaiting '
  'decide_suppression_request. SECURITY DEFINER because SUPPRESSIONS grants no INSERT '
  'to authenticated; self-checks app.can_write() and writes audit_log in the same '
  'transaction.';

revoke execute on function public.request_suppression(uuid, text) from public;
revoke execute on function public.request_suppression(uuid, text) from anon;
grant execute on function public.request_suppression(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_suppression_request — admin only
-- ---------------------------------------------------------------------------

create or replace function public.decide_suppression_request(
  p_suppression_id uuid,
  p_approve        boolean,
  p_note           text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_org_id     uuid;
  v_status     public.suppression_status;
  v_new_status public.suppression_status;
begin
  if not app.is_admin() then
    raise exception 'only an admin may decide a suppression request'
      using errcode = '42501';
  end if;

  select organisation_id, status into v_org_id, v_status
    from public.suppressions
   where id = p_suppression_id;

  if v_org_id is null then
    raise exception 'suppression request % not found', p_suppression_id
      using errcode = 'P0002';
  end if;

  if v_status <> 'pending' then
    raise exception 'suppression request % is not pending', p_suppression_id
      using errcode = '55000';
  end if;

  v_new_status := case when p_approve then 'active' else 'rejected' end;

  update public.suppressions
     set status = v_new_status,
         decided_by = v_actor,
         decided_at = now(),
         decision_note = p_note
   where id = p_suppression_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_approve then 'suppression_approved' else 'suppression_rejected' end,
    'organisations', v_org_id,
    jsonb_build_object('suppression_id', p_suppression_id, 'note', p_note)
  );
end;
$$;

comment on function public.decide_suppression_request(uuid, boolean, text) is
  'F251: admin approves or rejects a pending suppression request. SECURITY DEFINER; '
  'self-checks app.is_admin(), rejects a non-pending target, writes audit_log in the '
  'same transaction.';

revoke execute on function public.decide_suppression_request(uuid, boolean, text) from public;
revoke execute on function public.decide_suppression_request(uuid, boolean, text) from anon;
grant execute on function public.decide_suppression_request(uuid, boolean, text) to authenticated;
