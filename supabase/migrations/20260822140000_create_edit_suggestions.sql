-- Migration: create_edit_suggestions
-- Story: F077 Suggest Client Edit (#79)
-- Spec: docs/rls-permission-matrix.md §3.2 (canonical data — shared read, admin write)
--
-- WHAT THIS IS: the submission half of the edit-suggestion system. A CAM who spots a
--   wrong value on a client's six canonical identity fields proposes a correction; it
--   is stored here and nothing on organisations changes. The client profile keeps
--   showing the live value (F077 AC3) until an admin approves — approval/rejection is
--   F078/F079, which will flip status and apply/discard the value.
--
-- WHY ONLY SIX FIELDS: legal_name, website, contact_email, address_line_1, city,
--   postcode. Signed off by Bashir and the Project Leader (22 Aug 2026, #23), and the
--   same allowlist 20260815090000_create_field_discrepancies.sql already chose for the
--   same reason: these are the externally verifiable identity/location fields where a
--   wrong value corrupts dedup and outreach targeting. Everything else on
--   organisations is either low-risk descriptive data (trading_name, geographic_reach)
--   or already has its own audited write path (outreach_status -> set_outreach_status;
--   owner_id -> claim_organisation / reassign_ownership). The CHECK constraint below
--   and SENSITIVE_ORG_FIELDS in src/lib/edit-suggestions.ts are the same list in two
--   languages; changing one means changing both, and both live next to their readers.
--
-- WHO CAN SUBMIT: active CAMs only (app.is_cam()). An admin holds UPDATE on these
--   columns through the normal policy (matrix §3.2) and changes them directly; a
--   viewer has no write access at all. This mirrors request_client_ownership's
--   cam-only rule — the asker is the role that lacks the power.
--
-- NO AUDIT ROW ON SUBMISSION, DELIBERATELY: docs/audit-log-pattern.md scopes the trail
--   to writes that change ownership/status/role/approval state. Submitting a suggestion
--   changes none of those — it creates a row whose whole content is visible, exactly
--   like record_field_discrepancy ("flagging is not itself a decision") and unlike
--   ownership_requests (whose submission snapshot of owner_id made the audit row worth
--   it there). F078/F079's decide-RPCs are the state change; they will audit.
--
-- ONE PENDING SUGGESTION PER FIELD: unique partial index on (organisation_id,
--   field_name) WHERE status = 'pending'. Two rules hang off it, decided with the
--   Project Leader: a CAM re-suggesting their own still-pending edit SUPERSEDES it
--   (the old row is kept as 'superseded' — the queue shows one live proposal per
--   field), while a pending suggestion from ANOTHER CAM blocks submission (23505).
--   Decided rows are never deleted: what was proposed, by whom, and what it replaced
--   is the history F078/F079's decisions will be judged against.
--
-- current_value IS CAPTURED SERVER-SIDE: the RPC reads the organisation row inside the
--   same transaction and snapshots what it actually replaces (F077 AC2). A form-supplied
--   "current value" could be stale or forged; this one cannot diverge from the record
--   at submission time. It is nullable on purpose — suggesting a first-ever website for
--   a client with no website must record that it replaced nothing.
--
-- MVP LIMIT — NO PROPOSED-EMPTY VALUES: p_new_value must be non-blank, so a CAM cannot
--   propose clearing a field yet. Flagged rather than hidden; if clearing becomes a
--   real need it belongs to F078's scope too (applying empty vs NULL must then be
--   defined). Until then the UI says so.
--
-- Schema change approval record (SOP §7):
--   Change        | New table EDIT_SUGGESTIONS (+ edit_suggestion_status enum) and
--                 | suggest_organisation_edit RPC.
--   Reason        | F077 — CAMs need a safe route to correct wrong client data
--                 | without editing canonical records directly.
--   Compatibility | New table and one new RPC. No existing table, grant, or policy
--                 | changes. organisations keeps its current UPDATE policy untouched —
--                 | closing the §3.2 owned-row direct-edit gap for sensitive fields is
--                 | F020's job (restricted editing enforcement), not this ticket's.
--   Data migration| None.
--   Security      | RLS on. SELECT: admin sees all; any active CAM sees pending rows
--                 | (so two CAMs don't unknowingly propose conflicting edits); authors
--                 | see their own rows in every state. Viewers get nothing. No
--                 | INSERT/UPDATE/DELETE grant to authenticated — writes are the
--                 | SECURITY DEFINER RPC only, self-checking app.is_active_user() and
--                 | app.is_cam(). F078/F079 add their own admin-only decide path later.
--   Documentation | Data Model tabs 02/04/11 rows for EDIT_SUGGESTIONS to follow via
--                 | npm run export:data-model once the spreadsheet is updated (#79).
--
-- Reversibility: paired rollback in ../rollback/20260822140000_create_edit_suggestions.down.sql

create type public.edit_suggestion_status as enum
  ('pending', 'approved', 'rejected', 'superseded');

create table public.edit_suggestions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  field_name      text not null
                    check (field_name in
                      ('legal_name', 'website', 'contact_email',
                       'address_line_1', 'city', 'postcode')),
  -- What the field said when the suggestion was made, read from organisations by the
  -- RPC (not trusted from the form). Null means the field was empty when proposed.
  current_value    text,
  proposed_value   text not null,
  status           public.edit_suggestion_status not null default 'pending',
  requested_by     uuid not null references public.users (id),
  -- Set only when this row was replaced by the requester's own newer suggestion.
  superseded_by    uuid references public.edit_suggestions (id),
  decided_by       uuid references public.users (id),
  decided_at       timestamptz,
  rejection_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint edit_suggestions_proposed_not_blank check (btrim(proposed_value) <> ''),
  -- Decision fields travel together, same shape as ownership_requests_decision_consistent.
  -- 'superseded' is the requester's own action, not an admin decision, so it stays null/null.
  constraint edit_suggestions_decision_consistent check (
    (status = 'pending'    and decided_by is null and decided_at is null)
    or (status = 'superseded' and decided_by is null and decided_at is null)
    or (status in ('approved', 'rejected')
        and decided_by is not null and decided_at is not null)
  )
);

comment on table public.edit_suggestions is
  '#79 (F077): a CAM-proposed correction to one of a client''s six sensitive '
  'identity fields, held until an admin approves (F078) or rejects (F079). '
  'Nothing reaches organisations until approval; the profile shows live values.';
comment on column public.edit_suggestions.field_name is
  'One column of ORGANISATIONS — restricted to the signed-off sensitive six. The same '
  'allowlist as field_discrepancies/field_sources; keep in sync with '
  'SENSITIVE_ORG_FIELDS in src/lib/edit-suggestions.ts.';
comment on column public.edit_suggestions.current_value is
  'Snapshot of the organisations column at submission time, read by the RPC inside '
  'the submit transaction. Null = the field was empty before this suggestion.';
comment on column public.edit_suggestions.superseded_by is
  'The newer suggestion that replaced this still-pending one, when the same CAM '
  're-submits for the same field. Null unless status = ''superseded''.';
comment on column public.edit_suggestions.rejection_reason is
  'Optional note from the deciding admin (F079), relayed back to the CAM.';

-- At most one live proposal per field per client — the "block others" half of the
-- duplicate rule; supersede-own runs as update-then-insert inside the RPC transaction.
create unique index edit_suggestions_one_pending_per_field_idx
  on public.edit_suggestions (organisation_id, field_name)
  where status = 'pending';

create index edit_suggestions_pending_idx on public.edit_suggestions (created_at)
  where status = 'pending';
create index edit_suggestions_organisation_id_idx
  on public.edit_suggestions (organisation_id);
create index edit_suggestions_requested_by_idx
  on public.edit_suggestions (requested_by);

-- Revoke before grant (MIGRATIONS.md RLS recipe step 1). No INSERT/UPDATE/DELETE to
-- anyone: submission goes through suggest_organisation_edit below; decide paths come
-- with F078/F079.
revoke all on public.edit_suggestions from anon, authenticated;
grant select on public.edit_suggestions to authenticated;

alter table public.edit_suggestions enable row level security;

create policy edit_suggestions_select_visible on public.edit_suggestions
  for select to authenticated
  using (
    app.is_active_user()
    and (
      app.is_admin()
      -- Authors track their own submissions through every state (AC: they learn the
      -- outcome once F078/F079 exist).
      or requested_by = (select auth.uid())
      -- Any other active CAM may see what is still open, so nobody proposes a blind
      -- conflicting edit; settled history stays between the author and admins.
      or (status = 'pending' and app.is_cam())
    )
  );

-- ---------------------------------------------------------------------------
-- suggest_organisation_edit — a CAM proposes; nothing changes on the client
-- ---------------------------------------------------------------------------

create or replace function public.suggest_organisation_edit(
  p_organisation_id uuid,
  p_field_name      text,
  p_new_value       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := (select auth.uid());
  v_field     text := btrim(coalesce(p_field_name, ''));
  v_new_value text := coalesce(p_new_value, '');
  v_exists    boolean;
  v_current   text;
  v_pending   public.edit_suggestions%rowtype;
  v_id        uuid;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_cam() then
    raise exception 'only a CAM can suggest an edit'
      using errcode = '42501';
  end if;

  if v_field not in ('legal_name', 'website', 'contact_email',
                     'address_line_1', 'city', 'postcode') then
    raise exception 'this field does not accept suggested edits'
      using errcode = '23514';
  end if;

  if btrim(v_new_value) = '' then
    raise exception 'enter the corrected value — suggestions cannot clear a field'
      using errcode = '23514';
  end if;

  select exists (select 1 from public.organisations where id = p_organisation_id)
    into v_exists;

  if not v_exists then
    raise exception 'client % not found', p_organisation_id
      using errcode = 'P0002';
  end if;

  -- Snapshot what this suggestion would really replace (AC2), straight off the row:
  -- explicit per-column cases rather than dynamic SQL (same pattern as
  -- resolve_field_discrepancy's apply-back UPDATE).
  select case v_field
           when 'legal_name'    then legal_name
           when 'website'       then website
           when 'contact_email' then contact_email
           when 'address_line_1' then address_line_1
           when 'city'          then city
           when 'postcode'      then postcode
         end
    into v_current
    from public.organisations
   where id = p_organisation_id;

  if btrim(v_new_value) = btrim(coalesce(v_current, '')) then
    raise exception 'that is already the value on record'
      using errcode = '55000';
  end if;

  select * into v_pending
    from public.edit_suggestions
   where organisation_id = p_organisation_id
     and field_name = v_field
     and status = 'pending';

  if v_pending.id is not null then
    if v_pending.requested_by <> v_actor then
      raise exception 'another team member already has a pending suggestion for this field'
        using errcode = '23505';
    end if;
    -- Supersede own: the old proposal steps aside for the fresh one (kept, never
    -- deleted — the history is the point). superseded_by is filled after the insert
    -- below, because the new row's id must exist first.
    update public.edit_suggestions
       set status = 'superseded',
           updated_at = now()
     where id = v_pending.id;
  end if;

  insert into public.edit_suggestions
    (organisation_id, field_name, current_value, proposed_value, requested_by)
  values
    (p_organisation_id, v_field, v_current, btrim(v_new_value), v_actor)
  returning id into v_id;

  if v_pending.id is not null then
    update public.edit_suggestions
       set superseded_by = v_id
     where id = v_pending.id;
  end if;

  return v_id;
end;
$$;

comment on function public.suggest_organisation_edit(uuid, text, text) is
  '#79 (F077): a CAM proposes a correction to one of the six sensitive client fields. '
  'Snapshots the current value server-side, supersedes the caller''s own pending '
  'suggestion for that field, refuses while another CAM''s is pending, and inserts a '
  'pending row. Writes nothing to organisations and no audit_log row (submission is '
  'not a decision — see migration header). SECURITY DEFINER; self-checks '
  'app.is_active_user() and app.is_cam().';

revoke execute on function public.suggest_organisation_edit(uuid, text, text) from public;
revoke execute on function public.suggest_organisation_edit(uuid, text, text) from anon;
grant execute on function public.suggest_organisation_edit(uuid, text, text) to authenticated;
