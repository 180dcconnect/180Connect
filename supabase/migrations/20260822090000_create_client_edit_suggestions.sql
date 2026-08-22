-- Migration: create_client_edit_suggestions
-- Sequence: addition to the Data Model migration sequence, appended after step
--   21.4 create_ownership_requests — same reason ownership_requests itself gives
--   for not being renumbered (steps 4-17 are still unrun).
-- Story: F077 Suggest Client Edit (#79)
-- Spec: docs/rls-permission-matrix.md §3.19; closes open gap 2 in that document's
--   §6 ("No suggestion table. §4.3 grants CAMs 'suggest organisation field
--   correction' and F077 is a P1 story, but no table holds a suggestion.").
--
-- WHY THIS EXISTS: §3.2 of the matrix already says "Writes to canonical records
--   are admin-only; CAMs go through the suggestion flow (F077)" — but until now
--   that flow did not exist anywhere in the schema. This table is that flow's
--   whole storage: a CAM proposes a field's replacement value, an admin later
--   decides, and the live ORGANISATIONS row is untouched until they do.
--
-- SCOPE: F077 only. This migration builds the table and the one RPC that lands a
--   suggestion (suggest_client_edit) — not the two that decide one. F078 (Approve
--   Client Edit, #80) and F079 (Reject Client Edit, #81) are their own P2 stories
--   with their own dependency rows (F077, F181, F221) and are not built here.
--   `status` reserves 'approved'/'rejected' now — same reasoning create_suppressions
--   gives for reserving 'lifted' ahead of its own RPC (an unused enum value is a
--   one-way door in Postgres) — but nothing in this migration can produce them; a
--   pending row is the only row this schema can create until F078/F079 land.
--
-- SAME SIX FIELDS AS FIELD_DISCREPANCIES / FIELD_SOURCES (legal_name, website,
--   contact_email, address_line_1, city, postcode) — canonical, source-mapped
--   ORGANISATIONS columns. Kept identical on purpose, same reasoning
--   20260820100000's header gives: a field correctable here but not tracked for
--   provenance there (or the reverse) would silently diverge. mission_statement
--   is excluded for the same reason it is there — it lives on
--   ENRICHMENT_RESULTS, not ORGANISATIONS, and is LLM-derived rather than a raw
--   field a CAM would hand-correct.
--
-- CURRENT_VALUE IS SNAPSHOTTED, NOT LIVE: captured by suggest_client_edit at
--   proposal time (AC2 — "the current value it would replace"), same pattern
--   ownership_requests.current_owner_id uses for the same reason: the live value
--   can move while a suggestion sits pending, and whoever decides it needs to see
--   what the CAM was actually looking at when they proposed the change, not
--   whatever the field happens to hold by the time it's reviewed.
--
-- ONE PENDING SUGGESTION PER (ORGANISATION, FIELD): a partial unique index, same
--   shape as ownership_requests_one_open_per_requester_idx and
--   field_discrepancies_open_idx. Unlike the ownership-requests case, this one IS
--   per-organisation-and-field rather than per-requester: a second CAM proposing a
--   different value for a field that already has an open suggestion is exactly the
--   conflict an admin needs to see resolved once, not two competing queued edits
--   for the same cell.
--
-- Schema change approval record (SOP §7):
--   Change        | New table CLIENT_EDIT_SUGGESTIONS (not previously reserved in
--                 | the Data Model — added here, same as FIELD_DISCREPANCIES and
--                 | OWNERSHIP_REQUESTS before it) + client_edit_suggestion_status
--                 | enum + suggest_client_edit RPC.
--   Reason        | F077 — closes rls-permission-matrix.md open gap 2.
--   Compatibility | Additive only. Nothing existing changes.
--   Data migration| None.
--   Security      | RLS on. SELECT is shared across every active role (matrix
--                 | §3.3 NOTES precedent — F019-style relationship/context
--                 | visibility; AC3 needs a CAM to see that a suggestion is
--                 | pending, not just admins). No INSERT/UPDATE/DELETE grant to
--                 | authenticated: the only write is suggest_client_edit,
--                 | SECURITY DEFINER, self-checks app.can_write() (CAM or admin;
--                 | viewers excluded per that helper's own comment — "no notes,
--                 | no suggestions, no sends").
--   Documentation | Data Model tab 04 (CLIENT_EDIT_SUGGESTIONS) + tab 02 Data
--                 | Dictionary + tab 11 sequence — still owed against the
--                 | spreadsheet, same as every prior table added directly by a
--                 | migration ahead of the spreadsheet catching up.
--
-- Reversibility: paired rollback in
-- ../rollback/20260822090000_create_client_edit_suggestions.down.sql

create type public.client_edit_suggestion_status as enum ('pending', 'approved', 'rejected');

create table public.client_edit_suggestions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  field_name        text not null
                      check (field_name in
                        ('legal_name', 'website', 'contact_email',
                         'address_line_1', 'city', 'postcode')),
  -- Snapshotted at proposal time — see migration header. Null is a valid snapshot
  -- (the client testing note "client with missing data": the field was empty).
  current_value     text,
  proposed_value    text not null,
  status            public.client_edit_suggestion_status not null default 'pending',
  suggested_by      uuid not null references public.users (id),
  note              text,
  decided_by        uuid references public.users (id),
  decided_at        timestamptz,
  decision_note     text,
  created_at        timestamptz not null default now(),

  constraint client_edit_suggestions_proposed_not_blank check (btrim(proposed_value) <> ''),
  -- A suggestion that restates the current value corrects nothing; refused in the
  -- RPC too (with a message written for the CAM), but the constraint means no
  -- write path — including a future direct-RPC caller — can ever produce the row.
  constraint client_edit_suggestions_changes_something check (
    current_value is distinct from proposed_value
  ),
  -- Decision fields travel together, same shape as ownership_requests_decision_consistent.
  constraint client_edit_suggestions_decision_consistent check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

comment on table public.client_edit_suggestions is
  'F077: a CAM-proposed correction to a canonical ORGANISATIONS field. Pending until '
  'an admin decides (F078/F079, not yet built); the live organisation row is never '
  'touched by a pending suggestion — see migration header.';
comment on column public.client_edit_suggestions.current_value is
  'The field''s value at the moment the suggestion was proposed, snapshotted by '
  'suggest_client_edit — not a live read of ORGANISATIONS, which may have changed '
  'since. Null means the field was empty when proposed.';
comment on column public.client_edit_suggestions.note is
  'Optional context from the suggesting CAM on why the correction is needed. Unlike '
  'ownership_requests.reason this is not required — AC2 only asks for the field, '
  'the proposed value and the value it would replace.';

create unique index client_edit_suggestions_one_pending_per_field_idx
  on public.client_edit_suggestions (organisation_id, field_name)
  where status = 'pending';

create index client_edit_suggestions_organisation_id_idx
  on public.client_edit_suggestions (organisation_id);
create index client_edit_suggestions_pending_idx
  on public.client_edit_suggestions (created_at) where status = 'pending';

-- Revoke before grant (MIGRATIONS.md RLS recipe step 1).
revoke all on public.client_edit_suggestions from anon, authenticated;
grant select on public.client_edit_suggestions to authenticated;

alter table public.client_edit_suggestions enable row level security;

-- Shared read, same shape as NOTES (§3.3): "a pending correction exists on this
-- field" is exactly the reliability context F069/AC3-style client-profile viewing
-- needs, for every active role, not just admins.
create policy client_edit_suggestions_select_active on public.client_edit_suggestions
  for select to authenticated
  using (app.is_active_user());

-- No INSERT/UPDATE/DELETE policy for authenticated: the only write is
-- suggest_client_edit below. Deciding a suggestion (UPDATE to approved/rejected)
-- is F078/F079's RPC to add when those tickets are built; this migration grants
-- no path to it at all yet, direct or otherwise.

-- ---------------------------------------------------------------------------
-- suggest_client_edit — a CAM (or admin) proposes; nothing on ORGANISATIONS moves.
-- ---------------------------------------------------------------------------

create or replace function public.suggest_client_edit(
  p_organisation_id uuid,
  p_field_name      text,
  p_proposed_value  text,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_proposed   text := btrim(coalesce(p_proposed_value, ''));
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_current    text;
  v_org_exists boolean;
  v_id         uuid;
begin
  if not app.can_write() then
    raise exception 'only a CAM or admin can suggest a client edit'
      using errcode = '42501';
  end if;

  if p_field_name not in
    ('legal_name', 'website', 'contact_email', 'address_line_1', 'city', 'postcode')
  then
    raise exception 'field % cannot be suggested for correction', p_field_name
      using errcode = '22023';
  end if;

  if v_proposed = '' then
    raise exception 'a proposed value is required' using errcode = '23514';
  end if;

  select exists (select 1 from public.organisations where id = p_organisation_id)
    into v_org_exists;
  if not v_org_exists then
    raise exception 'organisation % not found', p_organisation_id
      using errcode = 'P0002';
  end if;

  -- Snapshot the live value now (migration header) — CASE over the fixed
  -- six-column allowlist, same technique record_field_source and
  -- resolve_field_discrepancy use to write one of a small fixed set of columns.
  select case p_field_name
    when 'legal_name'      then legal_name
    when 'website'          then website
    when 'contact_email'    then contact_email
    when 'address_line_1'   then address_line_1
    when 'city'              then city
    when 'postcode'          then postcode
  end into v_current
  from public.organisations
  where id = p_organisation_id;

  if v_current is not distinct from v_proposed then
    raise exception 'the proposed value is the same as the current value'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from public.client_edit_suggestions
     where organisation_id = p_organisation_id
       and field_name = p_field_name
       and status = 'pending'
  ) then
    raise exception 'this field already has a pending suggestion'
      using errcode = '23505';
  end if;

  insert into public.client_edit_suggestions
    (organisation_id, field_name, current_value, proposed_value, suggested_by, note)
  values
    (p_organisation_id, p_field_name, v_current, v_proposed, v_actor, v_note)
  returning id into v_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'client_edit_suggested', 'organisations', p_organisation_id,
    jsonb_build_object(
      'suggestion_id',  v_id,
      'field_name',     p_field_name,
      'current_value',  v_current,
      'proposed_value', v_proposed,
      'note',           v_note
    )
  );

  return v_id;
end;
$$;

comment on function public.suggest_client_edit(uuid, text, text, text) is
  'F077: a CAM (or admin) proposes a replacement value for a canonical client field. '
  'Moves nothing on ORGANISATIONS — inserts a pending row and audits the proposal. '
  'SECURITY DEFINER because CLIENT_EDIT_SUGGESTIONS grants no INSERT to authenticated; '
  'self-checks app.can_write(). Refuses a no-change proposal and a second pending '
  'suggestion on the same field.';

revoke execute on function public.suggest_client_edit(uuid, text, text, text) from public;
revoke execute on function public.suggest_client_edit(uuid, text, text, text) from anon;
grant execute on function public.suggest_client_edit(uuid, text, text, text) to authenticated;
