-- Migration: create_field_sources
-- Story: F044 Field-Level Source Tracking (#45)
-- Spec: docs/rls-permission-matrix.md §3.18
--
-- WHAT THIS CLOSES:
--   F043 (get_organisation_sources, 20260806120000) only ever answered "which
--   sources contributed to this client record" — record-level, not per-field.
--   F048 (field_discrepancies, 20260815090000) went further but explicitly flagged
--   what it wasn't: its own migration header and docs/rls-permission-matrix.md §3.16
--   / open-gap note 10 both say existing_source is "an approximation, not true
--   per-field tracking... closing it properly is F044's job." This migration is
--   that close: a real per-field provenance table, written at every point an
--   ORGANISATIONS field is actually written.
--
-- ONLY TWO WRITERS EXIST TODAY — both are covered here, nothing else needs it:
--   1. src/lib/standardize/write-organisations.ts's insertOrganisation (F041) —
--      the ingestion pipeline creating a new organisation row. Application code
--      calls the batched record_field_sources once per organisation with every
--      populated tracked field, so provenance commits all-or-nothing.
--   2. record_field_discrepancy's auto-resolve branch and resolve_field_discrepancy
--      (F048, this migration's create-or-replace below) — the only place an
--      existing organisation field is ever overwritten. Both now call
--      record_field_source in the same transaction as the organisations UPDATE.
--   Checked before writing this: no CAM/admin hand-edit UI or RPC exists yet (no
--   Server Action, route, or RPC does `update organisations set ... where id =`
--   outside these two), and MANUAL_ENTRY_RECORDS.converted_to_organisation_id is
--   documented but unbuilt (F036 is open). Nothing is silently missed by only
--   wiring these two; a future hand-edit feature (F036 or similar) is responsible
--   for calling record_field_source itself, same as this migration's own note on
--   F048 having been responsible for wiring this in once F044 existed.
--
-- MVP FIELD SCOPE: same six fields as FIELD_DISCREPANCIES (legal_name, website,
--   contact_email, address_line_1, city, postcode) — the only fields every
--   source's standardize mapper actually populates (StandardOrganisation, see
--   20260815090000's migration header for the full exclusion reasoning). Kept
--   identical on purpose: a field tracked for conflicts but not for provenance
--   (or vice versa) would be a silent gap between the two tables.
--
-- TICKET'S OWN AC1 EXAMPLE DOESN'T FIT TODAY'S SCHEMA, FLAGGED NOT SILENTLY
--   DROPPED: F044's issue (#45) illustrates AC1 with '"mission" from CharityBase' —
--   but mission_statement lives on ENRICHMENT_RESULTS (Data Model tab 04), an
--   LLM-derived enrichment field, not a raw source-mapped ORGANISATIONS column, and
--   no source mapper writes it. Tracking provenance for an LLM-derived field is a
--   different problem (whose enrichment run produced it, not whose API), out of
--   scope for this table. AC1 is satisfied for every field that genuinely has more
--   than one possible source today.
--
-- is_current, not a plain history log: exactly one row per (organisation,
--   field_name) has is_current = true (enforced by field_sources_current_idx, a
--   partial unique index — same technique as field_discrepancies_open_idx).
--   record_field_source flips the old row to false and inserts the new one in the
--   same statement pair, so "which source provided the live value" (AC1) is always
--   a single indexed lookup, while every superseded value+source stays queryable
--   for AC2 ("both values and their sources visible, not only the one that was
--   saved") without a separate conflict-log table.
--
-- WHY record_field_source IS service_role-ONLY, NOT authenticated: mirrors
--   record_client_criteria_outcome (20260808100000) and record_login_failure
--   (§3.10) — it is called two ways, neither of which is a signed-in user acting
--   directly on this table: (a) over PostgREST from write-organisations.ts, which
--   holds the service-role key server-side (buildAdminClient, ingestion runner
--   only); (b) as a nested plpgsql call from inside record_field_discrepancy /
--   resolve_field_discrepancy, which already self-check app.is_admin() before
--   reaching it — a second grant to authenticated would just be a second,
--   redundant door with weaker checks behind it.
--
-- Schema change approval record (SOP §7):
--   Change        | New table FIELD_SOURCES (not previously reserved in the Data
--                 | Model — added here, same as FIELD_DISCREPANCIES in F048) +
--                 | record_field_source and record_field_sources (batched, both
--                 | service_role) + get_field_sources (authenticated, self-checks
--                 | admin) RPCs. create-or-replaces
--                 | record_field_discrepancy and resolve_field_discrepancy
--                 | (F048, 20260815090000) to additionally call
--                 | record_field_source — fix-forward per MIGRATIONS.md, the
--                 | original migration file is untouched.
--   Reason        | F044 — real per-field provenance, closing the gap F048 flagged
--                 | (docs/rls-permission-matrix.md open-gap note 10).
--   Compatibility | New table, additive RPC. The two redefined functions keep
--                 | their exact signatures and existing behaviour; the only
--                 | addition is the record_field_source call and the extra
--                 | existing_source/incoming_source/raw_source_record_id locals
--                 | resolve_field_discrepancy now selects to make that call.
--   Data migration| None. Organisations created before this migration have no
--                 | field_sources rows until next written (import or resolution) —
--                 | acceptable for MVP, same backfill gap F043's RPC accepted for
--                 | manual-entry provenance.
--   Security      | RLS on; SELECT admin-only (same reasoning as
--                 | FIELD_DISCREPANCIES §3.16 — this is which source said what,
--                 | not CAM-visible data). No INSERT/UPDATE/DELETE grant to
--                 | authenticated; record_field_source is service_role-only.
--   Documentation | Data Model (03 Raw Data, 02 Data Dictionary) and
--                 | docs/rls-permission-matrix.md §3.18 + open-gap note 10 updated
--                 | alongside this PR.
--
-- Reversibility: paired rollback in
-- ../rollback/20260831100000_create_field_sources.down.sql — restores
-- record_field_discrepancy / resolve_field_discrepancy to their pre-F044 bodies
-- from 20260815090000, so a rollback doesn't leave F048 calling a dropped function.

create table public.field_sources (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id),
  field_name              text not null
                            check (field_name in
                              ('legal_name', 'website', 'contact_email',
                               'address_line_1', 'city', 'postcode')),
  value                   text not null,
  -- Same value set as the public.data_source_name domain (20260728153131) plus
  -- 'manual' — duplicated here rather than typed as the domain because a domain
  -- cannot be extended with a single extra value. Keep in sync with the domain:
  -- adding a source means altering that domain AND this check.
  source                  text not null
                            check (source in
                              ('charitybase', 'companies_house', '360giving',
                               'find_that_charity', 'globalgiving', 'candid',
                               'charity_commission', 'manual')),
  raw_source_record_id    uuid references public.raw_source_records (id),
  is_current              boolean not null default true,
  recorded_at             timestamptz not null default now()
);

comment on table public.field_sources is
  'F044: per-field provenance for ORGANISATIONS. One row per write to a tracked
  field; is_current marks the row currently live on the organisation for that
  field, so every superseded value+source stays queryable for AC2. Written only by
  record_field_source — the ingestion pipeline on initial import
  (write-organisations.ts, service_role), and record_field_discrepancy /
  resolve_field_discrepancy (F048) when a conflict is settled and overwrites the
  field. Same six-field scope as FIELD_DISCREPANCIES; see this migration header.';

comment on column public.field_sources.raw_source_record_id is
  'Null when source = ''manual'' (no raw import record exists) or when the value
  was applied by resolve_field_discrepancy choosing the existing side (which may
  itself trace to an older raw_source_records row this table does not re-link).';

-- Exactly one current row per (organisation, field) — same technique as
-- field_discrepancies_open_idx.
create unique index field_sources_current_idx
  on public.field_sources (organisation_id, field_name) where is_current;
create index field_sources_org_field_idx
  on public.field_sources (organisation_id, field_name);

-- Revoke before grant (MIGRATIONS.md RLS recipe step 1).
revoke all on public.field_sources from anon, authenticated;
grant select on public.field_sources to authenticated;

alter table public.field_sources enable row level security;

-- Admin-only read: same reasoning as FIELD_DISCREPANCIES §3.16 — seeing which
-- source said what for a field is not CAM-visible data.
create policy field_sources_select_admin on public.field_sources
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

-- No INSERT/UPDATE/DELETE policy for authenticated: rows are written only through
-- record_field_source below, which is granted to service_role, not authenticated.

-- ---------------------------------------------------------------------------
-- record_field_source — the single write path for this table.
-- ---------------------------------------------------------------------------

create or replace function public.record_field_source(
  p_organisation_id       uuid,
  p_field_name            text,
  p_value                 text,
  p_source                text,
  p_raw_source_record_id  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_field_name not in
    ('legal_name', 'website', 'contact_email', 'address_line_1', 'city', 'postcode')
  then
    raise exception 'field_name % is not tracked for per-field provenance', p_field_name
      using errcode = '22023';
  end if;

  -- Same value set as the column's check constraint above (data_source_name
  -- domain + 'manual'). Validating here too means a typo'd source fails loudly
  -- at the call site instead of silently landing as an unlabeled row in the UI.
  if p_source not in
    ('charitybase', 'companies_house', '360giving', 'find_that_charity',
     'globalgiving', 'candid', 'charity_commission', 'manual')
  then
    raise exception 'unknown field source: %', p_source using errcode = '22023';
  end if;

  -- Serialize the flip-and-insert pair per (organisation, field): two concurrent
  -- calls would otherwise both pass the UPDATE and collide on
  -- field_sources_current_idx, aborting the caller's whole transaction. Same
  -- shared-advisory-lock technique as the last-admin guard (20260804153000);
  -- xact-scoped, so it releases with the caller's transaction either way.
  perform pg_advisory_xact_lock(
    hashtext(p_organisation_id::text || ':' || p_field_name)
  );

  update public.field_sources
     set is_current = false
   where organisation_id = p_organisation_id
     and field_name = p_field_name
     and is_current = true;

  insert into public.field_sources (
    organisation_id, field_name, value, source, raw_source_record_id, is_current
  )
  values (
    p_organisation_id, p_field_name, p_value, p_source, p_raw_source_record_id, true
  );
end;
$$;

comment on function public.record_field_source(uuid, text, text, text, uuid) is
  'F044: records which source produced a field''s value, flipping the previous
  current row (if any) to is_current = false. Called by write-organisations.ts on
  initial import (service_role) and internally by record_field_discrepancy /
  resolve_field_discrepancy when a conflict resolution overwrites a field.';

revoke execute on function public.record_field_source(uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_field_source(uuid, text, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- record_field_sources — batched write path for the ingestion pipeline.
-- ---------------------------------------------------------------------------

-- One call per newly inserted organisation instead of one PostgREST round trip
-- per field: a single RPC is a single transaction, so provenance for an
-- organisation commits all-or-nothing — a mid-batch failure can no longer leave
-- half the fields attributed and half silently missing. Each field still goes
-- through record_field_source above, inheriting its field/source validation and
-- advisory lock. The F048 functions keep calling the singular form directly:
-- they already run inside their caller's transaction and resolve exactly one
-- field.
create or replace function public.record_field_sources(
  p_organisation_id       uuid,
  p_source                text,
  p_values                jsonb,
  p_raw_source_record_id  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field text;
  v_value text;
begin
  if jsonb_typeof(p_values) <> 'object' then
    raise exception 'p_values must be a JSON object of {field_name: value}'
      using errcode = '22023';
  end if;

  for v_field, v_value in
    select key, value from jsonb_each_text(p_values)
  loop
    perform public.record_field_source(
      p_organisation_id, v_field, v_value, p_source, p_raw_source_record_id
    );
  end loop;
end;
$$;

comment on function public.record_field_sources(uuid, text, jsonb, uuid) is
  'F044: records provenance for every populated tracked field on a newly
  inserted organisation in one transaction. p_values maps field_name to value;
  empty values should be omitted by the caller (nothing to attribute). Delegates
  each field to record_field_source, so validation and locking are identical.';

revoke execute on function public.record_field_sources(uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_field_sources(uuid, text, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- get_field_sources — read path for the client profile UI (AC1, AC2).
-- ---------------------------------------------------------------------------

create or replace function public.get_field_sources(p_organisation_id uuid)
returns table (
  field_name            text,
  value                 text,
  source                text,
  raw_source_record_id  uuid,
  is_current            boolean,
  recorded_at           timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'active account required' using errcode = '42501';
  end if;

  if not app.is_admin() then
    raise exception 'admin account required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organisations where id = p_organisation_id
  ) then
    raise exception 'organisation not found' using errcode = 'P0002';
  end if;

  return query
  select
    fs.field_name,
    fs.value,
    fs.source,
    fs.raw_source_record_id,
    fs.is_current,
    fs.recorded_at
  from public.field_sources fs
  where fs.organisation_id = p_organisation_id
  order by fs.field_name, fs.recorded_at desc;
end;
$$;

comment on function public.get_field_sources(uuid) is
  'F044: every recorded value+source for a client''s tracked fields, current and
  superseded, ordered newest-first within each field. Admin-only, mirroring
  FIELD_DISCREPANCIES §3.16 — this is which source said what, not CAM-visible.';

revoke execute on function public.get_field_sources(uuid) from public, anon;
grant execute on function public.get_field_sources(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Wire F048's two write paths into record_field_source (fix-forward:
-- 20260815090000 is untouched; these create-or-replace the same signatures).
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

  if exists (
    select 1 from public.field_discrepancies
     where organisation_id = p_organisation_id
       and field_name = p_field_name
       and status = 'resolved'
       and incoming_value = p_incoming_value
  ) then
    return;
  end if;

  if p_auto_resolved_choice is not null then
    v_value := case when p_auto_resolved_choice = 'existing'
                    then p_existing_value else p_incoming_value end;

    update public.organisations set
      legal_name      = case when p_field_name = 'legal_name'      then v_value else legal_name end,
      website          = case when p_field_name = 'website'          then v_value else website end,
      contact_email    = case when p_field_name = 'contact_email'    then v_value else contact_email end,
      address_line_1   = case when p_field_name = 'address_line_1'   then v_value else address_line_1 end,
      city              = case when p_field_name = 'city'              then v_value else city end,
      postcode          = case when p_field_name = 'postcode'          then v_value else postcode end
    where id = p_organisation_id;

    -- F044: record which source's value actually landed on organisations.
    -- raw_source_record_id only travels with the row when the incoming side won —
    -- the existing side's original record isn't re-identified here (see column
    -- comment on field_sources.raw_source_record_id).
    perform public.record_field_source(
      p_organisation_id,
      p_field_name,
      v_value,
      case when p_auto_resolved_choice = 'existing' then p_existing_source else p_incoming_source end,
      case when p_auto_resolved_choice = 'incoming' then p_raw_source_record_id else null end
    );

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
  value onto organisations, records it via record_field_source (F044) and writes
  audit_log (field_discrepancy_auto_resolved) in the same transaction — that path
  IS a decision. See migration header.';

revoke execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) from public;
revoke execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) from anon;
grant execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) to authenticated;

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
  v_existing_source text;
  v_incoming_value  text;
  v_incoming_source text;
  v_raw_source_record_id uuid;
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

  select organisation_id, field_name, existing_value, existing_source,
         incoming_value, incoming_source, raw_source_record_id, status
    into v_org_id, v_field_name, v_existing_value, v_existing_source,
         v_incoming_value, v_incoming_source, v_raw_source_record_id, v_status
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

  update public.organisations set
    legal_name      = case when v_field_name = 'legal_name'      then v_value else legal_name end,
    website          = case when v_field_name = 'website'          then v_value else website end,
    contact_email    = case when v_field_name = 'contact_email'    then v_value else contact_email end,
    address_line_1   = case when v_field_name = 'address_line_1'   then v_value else address_line_1 end,
    city              = case when v_field_name = 'city'              then v_value else city end,
    postcode          = case when v_field_name = 'postcode'          then v_value else postcode end
  where id = v_org_id;

  -- F044: record which source's value the admin actually picked.
  perform public.record_field_source(
    v_org_id,
    v_field_name,
    v_value,
    case when p_choice = 'existing' then v_existing_source else v_incoming_source end,
    case when p_choice = 'incoming' then v_raw_source_record_id else null end
  );

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
  the chosen value back onto organisations, records it via record_field_source
  (F044) and writes audit_log in the same transaction.';

revoke execute on function public.resolve_field_discrepancy(uuid, text, text) from public;
revoke execute on function public.resolve_field_discrepancy(uuid, text, text) from anon;
grant execute on function public.resolve_field_discrepancy(uuid, text, text) to authenticated;
