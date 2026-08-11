-- Migration: create_field_discrepancies
-- Story: F048 Data Discrepancy Detection (#49)
-- Spec: docs/rls-permission-matrix.md §3.16
--
-- WHAT THIS CLOSES:
--   write-organisations.ts (F041) is insert-only — it never updates an existing
--   organisations row, so nothing in the pipeline has ever had to decide what to do
--   when two sources disagree on a field. The only place the system asserts "this raw
--   record is the same client as an existing organisations row" is F042's
--   decide_duplicate_flag (20260809150000_create_entity_match_candidates.sql). This
--   migration adds the review queue for what happens next: when that confirmation
--   fires, the confirmed record's mapped field values are compared against the
--   existing organisation's current values, and anywhere they differ is flagged here
--   instead of being silently chosen one way or the other.
--
-- WHY THIS DOESN'T DEPEND ON F044 (FIELD-LEVEL SOURCE TRACKING, #45):
--   F048's issue lists F044 as a dependency, but F044 is unbuilt and unassigned, and
--   is not actually needed for this table. Provenance for the *incoming* side of a
--   comparison is read straight off raw_source_records.record_source at detection
--   time. Provenance for the *existing* side is approximated (see existing_source
--   below) rather than tracked per-field on organisations itself — a real
--   simplification, flagged rather than hidden, not a blocker.
--
-- existing_source: derived at detection time as the record_source of whichever
--   raw_source_records row has matched_organisation_id = organisation_id and
--   processing_status = 'validated' — the record that originally created the org (see
--   write-organisations.ts's processing_status semantics). KNOWN GAP: if a CAM has
--   since hand-edited that field through the organisation edit UI, this still shows
--   the original import source, not "a human" — there is no per-field provenance
--   without F044. Acceptable for MVP; closing it properly is F044's job, not this
--   ticket's.
--
-- WHY TWO RPCS, NOT ONE:
--   record_field_discrepancy (the flag) and resolve_field_discrepancy (the decision)
--   are asymmetric on purpose. Flagging is not itself a decision — it happens once
--   per detected conflict, called from the same request that just confirmed a
--   duplicate match — so it does not write audit_log (see docs/audit-log-pattern.md:
--   the trail should record real transitions, not noise). Resolving is the admin's
--   AC3 decision and does write audit_log, in the same transaction as applying the
--   chosen value back onto organisations.
--
-- WHY record_field_discrepancy IS CALLED WITH THE ADMIN'S OWN SESSION, NOT
--   service_role: unlike entity_match_candidates (written by the ingestion pipeline
--   holding the service key server-side), detection here runs as a follow-up inside
--   the signed-in admin's own PATCH /api/admin/duplicates request — see
--   src/lib/discrepancies/detect-field-discrepancies.ts. So this RPC self-checks
--   app.is_admin() the same way resolve_field_discrepancy does, and is granted to
--   authenticated, not service_role.
--
-- AC3 ("doesn't re-flag unless the underlying data changes again"): enforced inside
--   record_field_discrepancy, not by a unique constraint alone. Before writing, it
--   checks whether this exact incoming_value was already resolved for this
--   organisation+field; if so it no-ops. A second import that repeats the same
--   already-adjudicated incoming value does not reopen the conflict; a genuinely new
--   incoming value does.
--
-- MVP FIELD SCOPE: legal_name, website, contact_email, address_line_1, city,
--   postcode — the fields every source's standardize mapper actually populates today
--   (src/lib/standardize/types.ts's StandardOrganisation). Excluded: geographic_reach
--   (LLM-derived, not source-provided — a disagreement there is an enrichment-quality
--   question, not a data-conflict one), system/pipeline fields (organisation_type,
--   entry_method, country_code, is_international, is_verified, outreach_status,
--   owner_id — not raw source data), and trading_name (frequently null by design,
--   high false-positive risk for an MVP allowlist).
--
-- Schema change approval record (SOP §7):
--   Change        | New table FIELD_DISCREPANCIES (not previously reserved in the
--                 | Data Model — added here, unlike F042's ENTITY_MATCH_CANDIDATES
--                 | which pre-existed) + record_field_discrepancy and
--                 | resolve_field_discrepancy RPCs.
--   Reason        | F048 — flag a cross-source field conflict for admin review
--                 | instead of one value silently overwriting the other.
--   Compatibility | New table, no changes to existing tables or their grants. Applies
--                 | a resolved value back onto organisations via an explicit
--                 | case-per-column UPDATE scoped to the six MVP fields only.
--   Data migration| None.
--   Security      | RLS on; SELECT admin-only (same reasoning as entity_match_candidates
--                 | §3.15 — reviewing a flag means seeing which source said what, not
--                 | CAM-visible data). No INSERT/UPDATE grant to authenticated — both
--                 | writes are RPC-only, each self-checking app.is_admin().
--   Documentation | Data Model (03 Raw Data, 02 Data Dictionary) and
--                 | docs/rls-permission-matrix.md §3.16 updated alongside this PR.
--
-- Reversibility: paired rollback in ../rollback/20260811090000_create_field_discrepancies.down.sql

create table public.field_discrepancies (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id),
  field_name                  text not null
                                 check (field_name in
                                   ('legal_name', 'website', 'contact_email',
                                    'address_line_1', 'city', 'postcode')),
  existing_value               text not null,
  existing_source               text not null,
  incoming_value                text not null,
  incoming_source                text not null,
  raw_source_record_id         uuid not null references public.raw_source_records (id),
  entity_match_candidate_id    uuid references public.entity_match_candidates (id),
  status                       text not null default 'pending'
                                 check (status in ('pending', 'resolved')),
  resolved_choice               text check (resolved_choice in ('existing', 'incoming')),
  resolved_value                 text,
  resolved_by_user_id          uuid references public.users (id),
  resolved_at                   timestamptz,
  notes                        text,
  created_at                   timestamptz not null default now(),

  -- Decision fields travel together, same reasoning as entity_match_candidates_decision_consistent.
  constraint field_discrepancies_decision_consistent check (
    (status = 'pending' and resolved_choice is null and resolved_value is null
       and resolved_by_user_id is null and resolved_at is null)
    or (status = 'resolved' and resolved_choice is not null and resolved_value is not null
       and resolved_by_user_id is not null and resolved_at is not null)
  )
);

comment on table public.field_discrepancies is
  'F048: a field where a confirmed cross-source match (entity_match_candidates,
  F042) disagrees with the organisation''s current value. Written by
  record_field_discrepancy as a follow-up to decide_duplicate_flag confirming a
  match; decided by an admin via resolve_field_discrepancy, the only write path for
  status/resolved_*.';
comment on column public.field_discrepancies.existing_source is
  'Import-provenance approximation, not true per-field tracking: the record_source
  of whichever raw_source_records row originally created this organisation. A later
  manual edit to this field is not distinguished from the original import — see
  migration header. Closing that gap properly is F044''s job.';

create unique index field_discrepancies_open_idx
  on public.field_discrepancies (organisation_id, field_name) where status = 'pending';
create index field_discrepancies_org_idx on public.field_discrepancies (organisation_id);
create index field_discrepancies_pending_idx
  on public.field_discrepancies (created_at) where status = 'pending';

-- Revoke before grant (MIGRATIONS.md RLS recipe step 1).
revoke all on public.field_discrepancies from anon, authenticated;
grant select on public.field_discrepancies to authenticated;

alter table public.field_discrepancies enable row level security;

-- Admin-only read: same reasoning as entity_match_candidates §3.15 — reviewing a
-- flag means seeing which source said what, not CAM-visible data.
create policy field_discrepancies_select_admin on public.field_discrepancies
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

-- No INSERT/UPDATE policy for authenticated: rows are written only through the two
-- RPCs below, each self-checking app.is_admin().

-- ---------------------------------------------------------------------------
-- record_field_discrepancy — detection write, called from the admin's own PATCH
-- /api/admin/duplicates request right after decide_duplicate_flag confirms a match.
-- ---------------------------------------------------------------------------

create or replace function public.record_field_discrepancy(
  p_organisation_id           uuid,
  p_field_name                 text,
  p_existing_value              text,
  p_existing_source              text,
  p_incoming_value               text,
  p_incoming_source               text,
  p_raw_source_record_id        uuid,
  p_entity_match_candidate_id   uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'only an admin may record a field discrepancy'
      using errcode = '42501';
  end if;

  -- AC3: a value already adjudicated for this organisation+field does not reopen
  -- the conflict on a later import that repeats it. Only a genuinely different
  -- incoming value should flag again.
  if exists (
    select 1 from public.field_discrepancies
     where organisation_id = p_organisation_id
       and field_name = p_field_name
       and status = 'resolved'
       and incoming_value = p_incoming_value
  ) then
    return;
  end if;

  insert into public.field_discrepancies (
    organisation_id, field_name, existing_value, existing_source,
    incoming_value, incoming_source, raw_source_record_id, entity_match_candidate_id
  )
  values (
    p_organisation_id, p_field_name, p_existing_value, p_existing_source,
    p_incoming_value, p_incoming_source, p_raw_source_record_id, p_entity_match_candidate_id
  )
  on conflict (organisation_id, field_name) where status = 'pending'
  do update set
    existing_value = excluded.existing_value,
    existing_source = excluded.existing_source,
    incoming_value = excluded.incoming_value,
    incoming_source = excluded.incoming_source,
    raw_source_record_id = excluded.raw_source_record_id,
    entity_match_candidate_id = excluded.entity_match_candidate_id;
end;
$$;

comment on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid) is
  'F048: flags (or refreshes) an open conflict between an organisation''s current
  field value and an incoming source''s value. SECURITY DEFINER; self-checks
  app.is_admin(); no-ops if this incoming_value was already resolved for this
  organisation+field. Does not write audit_log — flagging is not a decision, see
  migration header.';

revoke execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid) from public;
revoke execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid) from anon;
grant execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_field_discrepancy — admin's AC3 decision
-- ---------------------------------------------------------------------------

create or replace function public.resolve_field_discrepancy(
  p_field_discrepancy_id uuid,
  p_choice                text,
  p_note                   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor          uuid := (select auth.uid());
  v_org_id         uuid;
  v_field_name     text;
  v_existing_value  text;
  v_incoming_value  text;
  v_status         text;
  v_value          text;
begin
  if not app.is_admin() then
    raise exception 'only an admin may resolve a field discrepancy'
      using errcode = '42501';
  end if;

  if p_choice not in ('existing', 'incoming') then
    raise exception 'choice must be ''existing'' or ''incoming''' using errcode = '22023';
  end if;

  select organisation_id, field_name, existing_value, incoming_value, status
    into v_org_id, v_field_name, v_existing_value, v_incoming_value, v_status
    from public.field_discrepancies
   where id = p_field_discrepancy_id;

  if v_org_id is null then
    raise exception 'field discrepancy % not found', p_field_discrepancy_id
      using errcode = 'P0002';
  end if;

  if v_status <> 'pending' then
    raise exception 'field discrepancy % is not pending', p_field_discrepancy_id
      using errcode = '55000';
  end if;

  v_value := case when p_choice = 'existing' then v_existing_value else v_incoming_value end;

  -- Explicit case-per-column, not dynamic SQL/format(): the field_name check
  -- constraint fixes this to six known columns, which makes an explicit list safer
  -- to review than building a column reference from a string at runtime.
  update public.organisations set
    legal_name      = case when v_field_name = 'legal_name'      then v_value else legal_name end,
    website          = case when v_field_name = 'website'          then v_value else website end,
    contact_email    = case when v_field_name = 'contact_email'    then v_value else contact_email end,
    address_line_1   = case when v_field_name = 'address_line_1'   then v_value else address_line_1 end,
    city              = case when v_field_name = 'city'              then v_value else city end,
    postcode          = case when v_field_name = 'postcode'          then v_value else postcode end
  where id = v_org_id;

  update public.field_discrepancies
     set status = 'resolved',
         resolved_choice = p_choice,
         resolved_value = v_value,
         resolved_by_user_id = v_actor,
         resolved_at = now(),
         notes = p_note
   where id = p_field_discrepancy_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    'field_discrepancy_resolved',
    'organisations', v_org_id,
    jsonb_build_object(
      'field_discrepancy_id', p_field_discrepancy_id,
      'field_name', v_field_name,
      'choice', p_choice,
      'value', v_value,
      'note', p_note
    )
  );
end;
$$;

comment on function public.resolve_field_discrepancy(uuid, text, text) is
  'F048: admin picks which of the two conflicting values to keep. SECURITY DEFINER;
  self-checks app.is_admin(), rejects a missing or already-resolved target, applies
  the chosen value back onto organisations and writes audit_log in the same
  transaction.';

revoke execute on function public.resolve_field_discrepancy(uuid, text, text) from public;
revoke execute on function public.resolve_field_discrepancy(uuid, text, text) from anon;
grant execute on function public.resolve_field_discrepancy(uuid, text, text) to authenticated;
