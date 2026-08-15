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
-- SOURCE PRIORITY DECIDES MOST CONFLICTS BEFORE A HUMAN SEES THEM:
--   Bashir's rule (13 Aug 2026 call, and this table's own data-dictionary entry):
--   Companies House outranks the Charity Commission, everything else is least
--   priority, and manual flagging is reserved for what those rules can't settle.
--   So the caller passes p_auto_resolved_choice when the two sources are both
--   ranked and differ, and this function writes the row already resolved instead
--   of pending — applying the winning value onto organisations and writing
--   audit_log, exactly as an admin's own resolve_field_discrepancy call would.
--   Only ties the ruleset can't break reach the review queue: the same source on
--   both sides, an unranked source, or an organisation whose originating record
--   can no longer be identified. See src/lib/standardize/source-priority.ts.
--
--   Why write the auto-settled rows at all, when the dictionary calls this table
--   the queue for unresolvable conflicts: that description stays true of its
--   *pending* rows, which is what the review UI shows. The resolved ones are the
--   record that an automatic overwrite happened. Dropping them would mean a
--   source could quietly change a client's registered address with no trace in
--   the app at all — the opposite of what a discrepancy feature is for.
--
-- WHY TWO RPCS, NOT ONE:
--   record_field_discrepancy (the flag) and resolve_field_discrepancy (the
--   admin's decision) are asymmetric on purpose. Flagging is not itself a
--   decision — it happens once per detected conflict, called from the same
--   request that just confirmed a duplicate match — so the flagging path does not
--   write audit_log (see docs/audit-log-pattern.md: the trail should record real
--   transitions, not noise). Both decision paths do write it, in the same
--   transaction as applying the chosen value back onto organisations:
--   'field_discrepancy_resolved' for the admin's own choice,
--   'field_discrepancy_auto_resolved' for the priority rules'. Two actions rather
--   than one flag on a shared action, so "what did a human actually decide" stays
--   answerable with a single query.
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
-- Reversibility: paired rollback in ../rollback/20260815090000_create_field_discrepancies.down.sql

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
  p_entity_match_candidate_id   uuid default null,
  p_auto_resolved_choice        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor            uuid := (select auth.uid());
  v_value            text;
  v_existing_open_id uuid;
begin
  if not app.is_admin() then
    raise exception 'only an admin may record a field discrepancy'
      using errcode = '42501';
  end if;

  if p_auto_resolved_choice is not null
     and p_auto_resolved_choice not in ('existing', 'incoming') then
    raise exception 'auto-resolved choice must be ''existing'' or ''incoming'''
      using errcode = '22023';
  end if;

  -- AC3: a value already adjudicated for this organisation+field does not reopen
  -- the conflict on a later import that repeats it. Only a genuinely different
  -- incoming value should flag again. Applies to both paths below: a repeat
  -- import must not re-decide (and re-audit) a conflict already settled once,
  -- whether it was settled by an admin or by the priority rules.
  if exists (
    select 1 from public.field_discrepancies
     where organisation_id = p_organisation_id
       and field_name = p_field_name
       and status = 'resolved'
       and incoming_value = p_incoming_value
  ) then
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- Auto-resolution path (F048, Bashir's rule confirmed 13 Aug 2026): both
  -- sources are ranked and they differ, so source priority settles this without
  -- a human. The row is still written — as an already-resolved row, with the
  -- value applied to organisations and an audit_log entry — rather than being
  -- silently dropped. The table's dictionary entry describes it as the queue for
  -- what priority *can't* settle, and that stays true of its pending rows; the
  -- resolved ones exist so an automatic overwrite is as accountable as a manual
  -- one. Without them, a source quietly changing a client's address would leave
  -- no trace anywhere.
  --
  -- resolved_by_user_id is the admin whose confirmation triggered detection, not
  -- a service account: this runs inside their own PATCH /api/admin/duplicates
  -- request, and field_discrepancies_decision_consistent requires a non-null
  -- actor. The distinction between "they chose this" and "the rules chose this"
  -- is carried by notes and by the audit_log action, which is
  -- field_discrepancy_auto_resolved, not field_discrepancy_resolved.
  -- ---------------------------------------------------------------------
  if p_auto_resolved_choice is not null then
    v_value := case when p_auto_resolved_choice = 'existing'
                    then p_existing_value else p_incoming_value end;

    -- Same six-column allowlist and same reasoning as resolve_field_discrepancy:
    -- explicit case-per-column, never dynamic SQL built from a field name.
    update public.organisations set
      legal_name      = case when p_field_name = 'legal_name'      then v_value else legal_name end,
      website          = case when p_field_name = 'website'          then v_value else website end,
      contact_email    = case when p_field_name = 'contact_email'    then v_value else contact_email end,
      address_line_1   = case when p_field_name = 'address_line_1'   then v_value else address_line_1 end,
      city              = case when p_field_name = 'city'              then v_value else city end,
      postcode          = case when p_field_name = 'postcode'          then v_value else postcode end
    where id = p_organisation_id;

    -- An open row for this field may already exist from an earlier import that
    -- the rules couldn't settle (e.g. the existing value's source was unknown
    -- then). Settle that row rather than leaving it pending beside a resolved
    -- one — field_discrepancies_open_idx allows only one pending row per
    -- organisation+field, and a stale one would misreport the queue.
    select id into v_existing_open_id
      from public.field_discrepancies
     where organisation_id = p_organisation_id
       and field_name = p_field_name
       and status = 'pending';

    if v_existing_open_id is not null then
      update public.field_discrepancies
         set existing_value = p_existing_value,
             existing_source = p_existing_source,
             incoming_value = p_incoming_value,
             incoming_source = p_incoming_source,
             raw_source_record_id = p_raw_source_record_id,
             entity_match_candidate_id = p_entity_match_candidate_id,
             status = 'resolved',
             resolved_choice = p_auto_resolved_choice,
             resolved_value = v_value,
             resolved_by_user_id = v_actor,
             resolved_at = now(),
             notes = 'Resolved automatically by source priority ('
                     || p_existing_source || ' vs ' || p_incoming_source || ').'
       where id = v_existing_open_id;
    else
      insert into public.field_discrepancies (
        organisation_id, field_name, existing_value, existing_source,
        incoming_value, incoming_source, raw_source_record_id,
        entity_match_candidate_id, status, resolved_choice, resolved_value,
        resolved_by_user_id, resolved_at, notes
      )
      values (
        p_organisation_id, p_field_name, p_existing_value, p_existing_source,
        p_incoming_value, p_incoming_source, p_raw_source_record_id,
        p_entity_match_candidate_id, 'resolved', p_auto_resolved_choice, v_value,
        v_actor, now(),
        'Resolved automatically by source priority ('
          || p_existing_source || ' vs ' || p_incoming_source || ').'
      );
    end if;

    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      v_actor,
      'field_discrepancy_auto_resolved',
      'organisations', p_organisation_id,
      jsonb_build_object(
        'field_name', p_field_name,
        'choice', p_auto_resolved_choice,
        'value', v_value,
        'existing_source', p_existing_source,
        'incoming_source', p_incoming_source,
        'entity_match_candidate_id', p_entity_match_candidate_id
      )
    );

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

comment on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) is
  'F048: flags (or refreshes) an open conflict between an organisation''s current
  field value and an incoming source''s value. SECURITY DEFINER; self-checks
  app.is_admin(); no-ops if this incoming_value was already resolved for this
  organisation+field. With p_auto_resolved_choice null this only flags, and writes
  no audit_log — flagging is not a decision. With it set (source priority settled
  the conflict) it instead writes an already-resolved row, applies the winning
  value onto organisations and writes audit_log
  (field_discrepancy_auto_resolved) in the same transaction — that path IS a
  decision. See migration header.';

revoke execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) from public;
revoke execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) from anon;
grant execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) to authenticated;

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
