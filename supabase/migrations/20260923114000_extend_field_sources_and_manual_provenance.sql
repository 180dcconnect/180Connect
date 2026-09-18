-- Migration: extend_field_sources_and_manual_provenance
-- Story: F044 completion — "What came from where" (#45) + the Manual Input
--   attribution gap on the Data Sources card.
-- Spec: docs/rls-permission-matrix.md §3.18 (rewritten by this migration); Data
--   Model tab 03 (FIELD_SOURCES) is updated in the same PR.
--
-- WHAT THIS CLOSES:
--   F044 shipped the FIELD_SOURCES table and its read/write RPCs, but the
--   client-profile UI was never wired up, and three write paths still record
--   no per-field provenance:
--     1. an admin's direct edit (admin-actions.ts) — documented as F044's
--        residual gap ("a future hand-edit feature is responsible for calling
--        record_field_source itself");
--     2. an approved edit suggestion (decide_edit_suggestion writes the column
--        but attributes nothing — the field history silently shows the register
--        that supplied the old value);
--     3. an approved manual entry (approve_manual_entry creates an
--        entry_method='manual' organisation whose fields are attributed to
--        nothing, so its Data Sources card can be empty — the exact gap the
--        20260923105000 provenance-audit cron watches for).
--
-- WHO DECIDED WHAT (sign-off 2 Sep 2026):
--   - Field provenance is visible to every active signed-in role. This
--     deliberately reverses F044's original "admin-only: which source said what
--     is not CAM-visible data" call — a CAM sees which register supplied a
--     value and who corrected it; there is nothing sensitive in that, and it is
--     the point of the feature.
--   - organisation_type joins the tracked field set (fields + mission +
--     pipeline stage are surfaced on the profile; mission and stage have their
--     own histories already).
--   - Manual attributions record the person behind them (recorded_by).
--
-- ORDER OF OPERATIONS, AND WHY THE POLICY IS RE-CREATED:
--   get_field_sources is rewritten first (while the admin-only RLS policy still
--   stands), the RLS policy is replaced immediately after, and only then are
--   the new grants/provenance calls added. The RPC is SECURITY DEFINER and
--   self-checks, so there is no window in which the function is widened but the
--   table is not — and no window in which the policy is widened before the
--   function exists to serve the new callers.
--
-- Schema change approval record (SOP §7):
--   Change         | FIELD_SOURCES: widen field_name CHECK to include
--                  | organisation_type; add recorded_by uuid null-able FK to
--                  | USERS. Rewrite get_field_sources to drop its admin check.
--                  | Replace its RLS SELECT policy. New SECURITY DEFINER RPC
--                  | apply_admin_field_edits (multi-field apply + provenance +
--                  | audit_log, same transaction). Fix-forward rewrites of
--                  | decide_edit_suggestion (20260822160200 body + provenance
--                  | call) and approve_manual_entry (20260817130000 body +
--                  | provenance calls). New grants on organisations.
--   Reason         | Close F044's residual gap: manual/admin writes were the
--                  | only unattributed field writes; wire the field-history UI.
--   Compatibility  | Additive. record_field_source/record_field_sources keep
--                  | their signatures and callers unchanged (the tracked-set
--                  | widening is inside their validation). decide_edit_suggestion
--                  | / approve_manual_entry keep signatures, errcodes and
--                  | behaviour; the only additions are record_field_source
--                  | calls and the extra locals they need.
--   Data migration | None. Existing rows get recorded_by = null ("system" —
--                  | pipeline writes), which get_field_sources passes through
--                  | untouched; the UI renders null as "pipeline".
--   Security       | RLS on FIELD_SOURCES stays on; the SELECT policy widens
--                  | from admin to app.is_active_user(), same as every other
--                  | shared-read child table. No INSERT/UPDATE/DELETE grant
--                  | appears — writes remain RPC-only. apply_admin_field_edits
--                  | self-checks app.is_admin() (SECURITY DEFINER bypasses RLS,
--                  | per docs/audit-log-pattern.md §2) and writes its audit_log
--                  | row in the same transaction as the column writes.
--   Documentation  | Matrix §3.18 rewritten; Data Model tab 03 FIELD_SOURCES
--                  | updated (generated files re-exported) in the same PR.
--
-- Reversibility: paired rollback in
-- ../rollback/20260923114000_extend_field_sources_and_manual_provenance.down.sql

-- ---------------------------------------------------------------------------
-- 1. FIELD_SOURCES: widen the tracked set, add recorded_by.
-- ---------------------------------------------------------------------------

-- Drop and recreate with organisation_type included. The constraint is not
-- validated against existing rows in a way that can fail: every existing value
-- is still in the new list.
alter table public.field_sources
  drop constraint field_sources_field_name_check;

alter table public.field_sources
  add constraint field_sources_field_name_check
  check (field_name in
    ('legal_name', 'website', 'contact_email',
     'address_line_1', 'city', 'postcode', 'organisation_type'));

-- The person a manual attribution belongs to. Null on every pipeline write
-- (write-organisations.ts holds no user context — a register supplied the
-- value) and on discrepancy auto-resolutions; set by apply_admin_field_edits.
-- Null = "the system", which is honest: the pipeline wrote it.
-- IF NOT EXISTS: staging already carries this column from the untracked
-- 20260914110000 apply (re-dated to this file in 993e42c9 without a recorded
-- history row). From scratch this is a plain add.
alter table public.field_sources
  add column if not exists recorded_by uuid references public.users (id);

comment on column public.field_sources.recorded_by is
  'The user whose action produced this value (apply_admin_field_edits), or null '
  'when the value came from the ingestion pipeline or a discrepancy '
  'auto-resolution — "the system", not a person. Kept rather than derived from '
  'audit_log so the field history is answerable from one table.';

-- ---------------------------------------------------------------------------
-- 2. get_field_sources — every active signed-in role, still self-checking.
-- ---------------------------------------------------------------------------

-- Rewritten while the old admin-only policy is still in force (header: order
-- of operations). The admin check is gone; the active-user check stays — the
-- same gate get_organisation_sources_with_actor applies.
-- 20260820100000 created this returning a narrower column list. `create or
-- replace` cannot change a function's OUT columns, so the old signature has to
-- go first — no call site survives a return-type change anyway.
drop function if exists public.get_field_sources(uuid);

create or replace function public.get_field_sources(p_organisation_id uuid)
returns table (
  field_name            text,
  value                 text,
  source                text,
  raw_source_record_id  uuid,
  is_current            boolean,
  recorded_at           timestamptz,
  recorded_by           uuid,
  recorded_by_name      text
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
    fs.recorded_at,
    fs.recorded_by,
    u.full_name
  from public.field_sources fs
  left join public.users u on u.id = fs.recorded_by
  where fs.organisation_id = p_organisation_id
  order by fs.field_name, fs.recorded_at desc;
end;
$$;

comment on function public.get_field_sources(uuid) is
  'F044 (widened 20260923114000): every recorded value+source for a client''s '
  'tracked fields, current and superseded, newest-first within each field, with '
  'the recorded_by name resolved. Readable by every active signed-in role '
  '(reverses the original admin-only call — sign-off in the migration header): '
  'the field history is the point of the feature, and carries nothing a CAM '
  'cannot already see on the record.';

revoke execute on function public.get_field_sources(uuid) from public, anon;
grant execute on function public.get_field_sources(uuid) to authenticated;

-- The table policy widens with the function — one motion. Same shape as every
-- other shared-read child table (notes, attachments): all active roles read.
drop policy if exists field_sources_select_admin on public.field_sources;

-- Drop-then-create: staging already carries field_sources_select from the
-- untracked 20260914110000 apply (see recorded_by above). From scratch the
-- drop is a no-op and the create stands.
drop policy if exists field_sources_select on public.field_sources;

create policy field_sources_select on public.field_sources
  for select to authenticated
  using (app.is_active_user());

-- The original grant block granted SELECT to authenticated with the admin
-- policy; the grant itself was never the secret — the policy was. It stands,
-- and is restated here so this migration carries the full effective state.
grant select on public.field_sources to authenticated;

-- ---------------------------------------------------------------------------
-- 3. record_field_source — learn the tracked set's new member and recorded_by.
-- ---------------------------------------------------------------------------

-- Signature unchanged in practice (+ one optional param appended, so both
-- existing call sites — the batched form and F048's two functions — keep
-- working untouched).
-- p_recorded_by is appended, which makes this a *new* signature: the five-arg
-- form from 20260820100000 would linger and every positional five-arg call
-- would become ambiguous. Drop it.
drop function if exists public.record_field_source(uuid, text, text, text, uuid);

create or replace function public.record_field_source(
  p_organisation_id       uuid,
  p_field_name            text,
  p_value                 text,
  p_source                text,
  p_raw_source_record_id  uuid default null,
  p_recorded_by           uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- organisation_type added to the tracked set this migration. Same fixed list
  -- as the column's CHECK constraint (header: kept identical on purpose).
  if p_field_name not in
    ('legal_name', 'website', 'contact_email', 'address_line_1', 'city',
     'postcode', 'organisation_type')
  then
    raise exception 'field_name % is not tracked for per-field provenance', p_field_name
      using errcode = '22023';
  end if;

  -- Same value set as the column's source CHECK constraint, widened by
  -- 20260923122000 to add the two data_source_name values that were missing:
  -- 'charity_commission_bulk' and 'website'. Both are real sources that write
  -- organisations, so every charity imported through the bulk route silently
  -- recorded no per-field provenance at all — the insert is best-effort, so it
  -- only logged. Keep this list and the CHECK constraint identical.
  if p_source not in
    ('charitybase', 'companies_house', '360giving', 'find_that_charity',
     'globalgiving', 'candid', 'charity_commission', 'charity_commission_bulk',
     'website', 'manual')
  then
    raise exception 'unknown field source: %', p_source using errcode = '22023';
  end if;

  -- recorded_by must name a real user when present: a dangling uuid would
  -- otherwise render "A former team member" for someone who never existed.
  -- The FK cannot fire on a null, and cannot be trusted to be hit before this
  -- check in every call path.
  if p_recorded_by is not null and not exists (
    select 1 from public.users where id = p_recorded_by
  ) then
    raise exception 'recorded_by % is not a known user', p_recorded_by
      using errcode = '22023';
  end if;

  -- Serialize the flip-and-insert pair per (organisation, field): two
  -- concurrent calls would otherwise both pass the UPDATE and collide on
  -- field_sources_current_idx, aborting the caller's whole transaction.
  -- (Carried unchanged from 20260820100000.)
  perform pg_advisory_xact_lock(
    hashtext(p_organisation_id::text || ':' || p_field_name)
  );

  update public.field_sources
     set is_current = false
   where organisation_id = p_organisation_id
     and field_name = p_field_name
     and is_current = true;

  insert into public.field_sources (
    organisation_id, field_name, value, source, raw_source_record_id,
    recorded_by, is_current
  )
  values (
    p_organisation_id, p_field_name, p_value, p_source, p_raw_source_record_id,
    p_recorded_by, true
  );
end;
$$;

comment on function public.record_field_source(uuid, text, text, text, uuid, uuid) is
  'F044 (widened 20260923114000): records which source produced a field''s value,
  flipping the previous current row (if any) to is_current = false. organisation_type
  joined the tracked set; p_recorded_by attributes a manual write to the person
  behind it (null = pipeline/system). Callers: write-organisations.ts on initial
  import (service_role), record_field_discrepancy / resolve_field_discrepancy
  (F048), apply_admin_field_edits (this migration), decide_edit_suggestion
  (20260923114000 rewrite), approve_manual_entry (20260923114000 rewrite).';

-- Only the six-argument form exists now; the five-argument one was dropped
-- above rather than left behind as an ambiguous overload.
revoke execute on function public.record_field_source(uuid, text, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_field_source(uuid, text, text, text, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. apply_admin_field_edits — the admin hand-edit path, attributed.
-- ---------------------------------------------------------------------------

-- Replaces the direct UPDATE in adminDirectEditsAction (src/app/clients/[id]/
-- admin-actions.ts). One RPC per submission, one transaction: the column
-- writes, the FIELD_SOURCES rows (source='manual', recorded_by=the admin) and
-- one audit_log row land together or not at all — docs/audit-log-pattern.md §1
-- forbids the audit insert as a separate step.
--
-- Trust boundary: the RPC re-implements the action's guards rather than
-- trusting them (audit-log-pattern §2) — admin role, per-field allowlist.
-- Value normalisation (normaliseFieldValue) and the enum-membership check stay
-- in the action; the RPC accepts the value the caller would have written.
--
-- All-or-nothing is deliberate: adminDirectEditsAction batched its columns
-- into a single UPDATE for exactly this reason ("the record is never briefly
-- half-corrected"), and an exception rolls the whole batch back — per-field
-- verdicts still come back to the UI through the returned per-field outcome.
create or replace function public.apply_admin_field_edits(
  p_organisation_id uuid,
  p_changes         jsonb,   -- [{field_name, value}] — every element applied
  p_reason          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_change      jsonb;
  v_field       text;
  v_value       text;
  v_valid       boolean;
  v_results     jsonb := '[]'::jsonb;
  v_applied     int  := 0;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active' using errcode = '42501';
  end if;
  if not app.is_admin() then
    raise exception 'only an admin can edit directly' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'nothing has been changed yet' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organisations where id = p_organisation_id
  ) then
    raise exception 'organisation not found' using errcode = 'P0002';
  end if;

  -- Pre-flight over every element: one bad change fails the whole batch before
  -- any column is touched, so the record is never briefly half-corrected.
  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_field := v_change->>'field_name';
    if v_field not in
      ('legal_name', 'organisation_type', 'city', 'address_line_1', 'postcode',
       'country_code', 'contact_email', 'website', 'sector', 'sub_sector',
       'geographic_reach')
    then
      raise exception '% cannot be edited here', v_field using errcode = '55000';
    end if;
    if nullif(btrim(coalesce(v_change->>'value', '')), '') is null then
      raise exception 'a change is missing its value' using errcode = '22023';
    end if;
  end loop;

  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_field := v_change->>'field_name';
    v_value := btrim(v_change->>'value');

    -- Provenance covers exactly the tracked fields. Other admin-writable
    -- columns still get written; they just have no field history yet — the
    -- honest state, not a fake row.
    v_valid := v_field in
      ('legal_name', 'website', 'contact_email', 'address_line_1', 'city',
       'postcode', 'organisation_type');

    if v_valid then
      perform public.record_field_source(
        p_organisation_id, v_field, v_value, 'manual', null, v_actor
      );
    end if;

    -- Guarded dynamic apply-back, same three guards as decide_edit_suggestion's
    -- (20260822160200): FK-shaped identifier comes from this fixed allowlist,
    -- existence check, %-quoted identifier with a parameterised value.
    -- 'organisation_type' is a Postgres enum column, which is why the update is
    -- dynamic rather than a case list.
    if not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'organisations'
         and column_name  = v_field
    ) then
      raise exception 'restricted field % no longer exists on the client record', v_field
        using errcode = '55000';
    end if;

    execute format(
      'update public.organisations set %I = $1 where id = $2',
      v_field
    ) using v_value, p_organisation_id;

    v_applied := v_applied + 1;
    v_results := v_results || jsonb_build_object('field_name', v_field, 'ok', true);
  end loop;

  -- One audit row per submission, not per field (audit-log-pattern §3: the
  -- trail records real transitions; set_user_role set the no-noise convention).
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    'fields_direct_edited',
    'organisations', p_organisation_id,
    jsonb_build_object(
      'changes',        p_changes,
      'reason',         nullif(btrim(coalesce(p_reason, '')), ''),
      'applied_count',  v_applied
    )
  );

  return v_results;
end;
$$;

comment on function public.apply_admin_field_edits(uuid, jsonb, text) is
  'Admin direct field edits, attributed (20260923114000): applies each {field_name, '
  'value} change onto organisations, records FIELD_SOURCES provenance (source=''manual'', '
  'recorded_by=the admin) for tracked fields, and writes one audit_log row '
  '(fields_direct_edited) — all in the caller''s transaction. SECURITY DEFINER; '
  'self-checks app.is_admin(). Replaces adminDirectEditsAction''s direct UPDATE. '
  'Value normalisation and enum checks stay in the action; the RPC accepts what '
  'the action validated.';

revoke execute on function public.apply_admin_field_edits(uuid, jsonb, text)
  from public, anon;
grant execute on function public.apply_admin_field_edits(uuid, jsonb, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Fix-forward: approved edit suggestions are provenance events too.
-- ---------------------------------------------------------------------------

-- Body = 20260822160200 byte-for-byte plus the F044 provenance call. The stale-
-- snapshot guard, errcodes, audit row and CAM notification are all unchanged.
-- current_value can be null (F077: "Null = the field was empty before this
-- suggestion") — record_field_source writes only non-null provenance rows, so
-- an approval that fills an empty field gets history from its approval onward,
-- and nothing fabricates an empty-string "original".
create or replace function public.decide_edit_suggestion(
  p_suggestion_id uuid,
  p_approve       boolean,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_suggestion  public.edit_suggestions%rowtype;
  v_live_value  text;
  v_reason      text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_admin() then
    raise exception 'only an admin may decide a suggested edit'
      using errcode = '42501';
  end if;

  select * into v_suggestion
    from public.edit_suggestions
   where id = p_suggestion_id
     for update;

  if v_suggestion.id is null then
    raise exception 'suggested edit % not found', p_suggestion_id
      using errcode = 'P0002';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'suggested edit % has already been decided', p_suggestion_id
      using errcode = '55000';
  end if;

  -- p_reason is optional by design (F079 AC2 "allows the admin to LEAVE a reason"):
  -- blank strings are normalised to null so the column never carries whitespace
  -- masquerading as a reason.

  if p_approve then
    -- Stale-snapshot guard: read what the column says NOW, inside the same
    -- transaction that will write it.
    select to_jsonb(o) ->> v_suggestion.field_name
      into v_live_value
      from public.organisations o
     where o.id = v_suggestion.organisation_id;

    if v_live_value is distinct from v_suggestion.current_value then
      raise exception 'the live value changed since this was suggested — review the client and decide again'
        using errcode = '55000';
    end if;

    -- Guarded dynamic apply-back (see header): FK-validated identifier, existence
    -- check, %-quoted identifier, parameterised values. The organisations
    -- updated_at trigger fires as normal.
    if not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'organisations'
         and column_name  = v_suggestion.field_name
    ) then
      raise exception 'restricted field % no longer exists on the client record', v_suggestion.field_name
        using errcode = '55000';
    end if;

    execute format(
      'update public.organisations set %I = $1 where id = $2',
      v_suggestion.field_name
    ) using v_suggestion.proposed_value, v_suggestion.organisation_id;

    -- F044 (20260923114000): the approval is a write to the field, so the field
    -- history says a person corrected it, not that the old register still owns
    -- the value. Provenance covers exactly the seven tracked fields; anything
    -- else (runtime-restricted columns such as trading_name) is written with no
    -- field history — the honest state, not an exception that would abort the
    -- whole approval. Same guard as apply_admin_field_edits above.
    if v_suggestion.field_name in
      ('legal_name', 'website', 'contact_email', 'address_line_1', 'city',
       'postcode', 'organisation_type')
    then
      perform public.record_field_source(
        v_suggestion.organisation_id,
        v_suggestion.field_name,
        v_suggestion.proposed_value,
        'manual',
        null,
        v_actor
      );
    end if;
  end if;

  update public.edit_suggestions
     set status           = case when p_approve
                                then 'approved'::public.edit_suggestion_status
                                else 'rejected'::public.edit_suggestion_status end,
         decided_by       = v_actor,
         decided_at       = now(),
         rejection_reason = case when p_approve then null else v_reason end,
         updated_at       = now()
   where id = v_suggestion.id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_approve then 'edit_suggestion_approved' else 'edit_suggestion_rejected' end,
    'organisations', v_suggestion.organisation_id,
    jsonb_build_object(
      'suggestion_id', v_suggestion.id,
      'field',         v_suggestion.field_name,
      'from',          v_suggestion.current_value,
      'to',            case when p_approve then v_suggestion.proposed_value else null end,
      'requested_by',  v_suggestion.requested_by,
      'reason',        v_reason
    )
  );

  -- AC3: tell the submitting CAM which way it went. create_notification is also
  -- SECURITY DEFINER and self-checking; it silently skips a deactivated recipient.
  perform public.create_notification(
    v_suggestion.requested_by,
    'edit_suggestion_decided',
    case when p_approve
         then 'Your suggested edit was approved'
         else 'Your suggested edit was not applied' end,
    case when p_approve
         then 'The correction to ' || v_suggestion.field_name || ' is now live on the client record.'
         else 'The proposed change to ' || v_suggestion.field_name || ' was reviewed and not applied.'
              || coalesce(' Reason: ' || v_reason, '')
    end,
    '/clients/' || v_suggestion.organisation_id,
    'organisations',
    v_suggestion.organisation_id,
    v_actor
  );
end;
$$;

comment on function public.decide_edit_suggestion(uuid, boolean, text) is
  '#80/#81 (F078/F079), rewritten by F020 (#23), re-rewritten 20260923114000: '
  'approval additionally records FIELD_SOURCES provenance (source=''manual'', '
  'recorded_by=the deciding admin) so the field history attributes the correction '
  'to a person. Everything else — guards, errcodes, audit, notification — '
  'unchanged from the F020 body.';

-- ---------------------------------------------------------------------------
-- 6. Fix-forward: approved manual entries attribute their fields to Manual Input.
-- ---------------------------------------------------------------------------

-- Body = 20260817130000 plus, on create_new only, a record_field_source call
-- per populated tracked field (source='manual', recorded_by=the submitting
-- CAM — the person who typed the values, which is the whole point of the
-- attribution; the approving admin is the gate, not the author). The link-
-- existing branch writes nothing: those fields already belong to whichever
-- source produced them, and overwriting their provenance with "manual" would
-- be a lie about who supplied the data. The mission insert (enrichment_results)
-- already carries confidence_score=1; its provenance surfaces through the
-- mission row itself, not FIELD_SOURCES.
-- p_duplicate_decision and p_admin_confirmed_eligible swap positions, so this
-- is a new signature rather than a replacement; the old one would stay behind
-- and make named-argument calls ambiguous.
drop function if exists public.approve_manual_entry(uuid, boolean, text, uuid, text);

create or replace function public.approve_manual_entry(
  p_entry_id                 uuid,
  p_duplicate_decision       text,
  p_admin_confirmed_eligible boolean default null,
  p_candidate_organisation_id uuid default null,
  p_notes                    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_entry public.manual_entry_records%rowtype;
  v_match_organisation_id uuid;
  v_organisation_id uuid;
  v_normalised_name text;
  v_score numeric;
begin
  if not app.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  select * into v_entry
    from public.manual_entry_records
   where id = p_entry_id
   for update;
  if v_entry.id is null then
    raise exception 'manual entry not found' using errcode = 'P0002';
  end if;
  if v_entry.review_status <> 'pending' then
    raise exception 'manual entry has already been reviewed' using errcode = '55000';
  end if;
  if p_duplicate_decision is null
     or p_duplicate_decision not in ('create_new', 'link_existing') then
    raise exception 'choose whether this is a new or existing organisation' using errcode = '22023';
  end if;

  -- F047: charity/both meet the configured v1 policy. Company/other require the
  -- explicit human evidence checkbox; the UI still runs the shared configurable
  -- TypeScript policy first, while this is the non-bypassable database boundary.
  if v_entry.organisation_type in ('company', 'other')
     and p_admin_confirmed_eligible is not true then
    raise exception 'confirm the organisation is eligible before approval' using errcode = '22023';
  end if;

  -- F042 strongest key: an existing registry identifier with the same value.
  if nullif(trim(v_entry.registry_number), '') is not null then
    select identifier.organisation_id into v_match_organisation_id
      from public.organisation_identifiers identifier
     where trim(identifier.identifier_value) = trim(v_entry.registry_number)
     order by identifier.verified desc, identifier.created_at
     limit 1;
  end if;

  -- F042 fallback: lower-case, remove punctuation and Ltd/Limited, collapse spaces.
  if v_match_organisation_id is null then
    v_normalised_name := trim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim(v_entry.legal_name)), '[.,()]', '', 'g'),
        '(^|[[:space:]])(ltd|limited)([[:space:]]|$)', ' ', 'g'
      ),
      '[[:space:]]+', ' ', 'g'
    ));

    select organisation.id into v_match_organisation_id
      from public.organisations organisation
     where trim(regexp_replace(
       regexp_replace(
         regexp_replace(lower(trim(organisation.legal_name)), '[.,()]', '', 'g'),
         '(^|[[:space:]])(ltd|limited)([[:space:]]|$)', ' ', 'g'
       ),
       '[[:space:]]+', ' ', 'g'
     )) = v_normalised_name
     order by organisation.created_at, organisation.id
     limit 1;
  end if;

  -- Serialize approvals for the same normalized identity so two simultaneous
  -- manual reviews cannot both observe "no match" and create active duplicates.
  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(nullif(trim(v_entry.registry_number), ''), v_normalised_name),
    0
  ));

  -- Repeat both match stages after acquiring the identity lock. The first reviewer
  -- may have created the organisation while this transaction was waiting.
  v_match_organisation_id := null;
  if nullif(trim(v_entry.registry_number), '') is not null then
    select identifier.organisation_id into v_match_organisation_id
      from public.organisation_identifiers identifier
     where trim(identifier.identifier_value) = trim(v_entry.registry_number)
     order by identifier.verified desc, identifier.created_at
     limit 1;
  end if;
  if v_match_organisation_id is null then
    select organisation.id into v_match_organisation_id
      from public.organisations organisation
     where trim(regexp_replace(
       regexp_replace(
         regexp_replace(lower(trim(organisation.legal_name)), '[.,()]', '', 'g'),
         '(^|[[:space:]])(ltd|limited)([[:space:]]|$)', ' ', 'g'
       ),
       '[[:space:]]+', ' ', 'g'
     )) = v_normalised_name
     order by organisation.created_at, organisation.id
     limit 1;
  end if;

  -- Re-check the candidate in the transaction. A stale or forged hidden input cannot
  -- approve against a different result from the one the database sees now.
  if p_candidate_organisation_id is distinct from v_match_organisation_id then
    raise exception 'the duplicate result changed; run the checks again' using errcode = '55000';
  end if;

  if v_match_organisation_id is not null and p_duplicate_decision = 'create_new'
     and length(trim(coalesce(p_notes, ''))) < 3 then
    raise exception 'explain why this matching organisation is genuinely separate' using errcode = '22023';
  end if;
  if v_match_organisation_id is null and p_duplicate_decision = 'link_existing' then
    raise exception 'no existing organisation matches this submission' using errcode = '55000';
  end if;

  if p_duplicate_decision = 'link_existing' then
    v_organisation_id := v_match_organisation_id;
  else
    v_score := round((
      1
      + case when nullif(trim(v_entry.website), '') is not null then 1 else 0 end
      + case when nullif(trim(v_entry.contact_email), '') is not null then 1 else 0 end
      + case when nullif(trim(v_entry.address_line_1), '') is not null then 1 else 0 end
      + case when nullif(trim(v_entry.city), '') is not null then 1 else 0 end
      + case when nullif(trim(v_entry.postcode), '') is not null then 1 else 0 end
    )::numeric / 8, 2);

    insert into public.organisations (
      legal_name, trading_name, country_code, is_international, entry_method,
      is_verified, organisation_type, website, contact_email, address_line_1,
      city, postcode, geographic_reach, data_completeness_score, owner_id, is_seed
    ) values (
      trim(v_entry.legal_name), '', v_entry.country_code, v_entry.country_code <> 'GB',
      'manual', false, v_entry.organisation_type, v_entry.website, v_entry.contact_email,
      v_entry.address_line_1, v_entry.city, v_entry.postcode, null, v_score, null, false
    ) returning id into v_organisation_id;

    insert into public.enrichment_results (
      organisation_id, mission_statement, website_url, confidence_score, needs_review
    ) values (
      v_organisation_id, v_entry.mission_statement, v_entry.website, 1, false
    );

    if nullif(trim(v_entry.registry_number), '') is not null then
      insert into public.organisation_identifiers (
        organisation_id, identifier_type, identifier_value, registry_name,
        registry_country, is_primary, verified
      ) values (
        v_organisation_id, 'manual', trim(v_entry.registry_number),
        nullif(trim(v_entry.registry_name), ''), v_entry.country_code, true, false
      );
    end if;

    -- F044 (20260923114000): a hand-created record's fields are Manual Input,
    -- attributed to the CAM who typed them — the manual entry's provenance is
    -- the person, not a register. legal_name is not null on the entry, so the
    -- row is guaranteed; every other field is attributed only if the CAM
    -- supplied one. organisation_type was joined to the tracked set by this
    -- migration, so the entry's own type is attributed too.
    perform public.record_field_source(
      v_organisation_id, 'legal_name', trim(v_entry.legal_name), 'manual', null,
      v_entry.submitted_by_user_id
    );
    if nullif(trim(v_entry.website), '') is not null then
      perform public.record_field_source(
        v_organisation_id, 'website', trim(v_entry.website), 'manual', null,
        v_entry.submitted_by_user_id
      );
    end if;
    if nullif(trim(v_entry.contact_email), '') is not null then
      perform public.record_field_source(
        v_organisation_id, 'contact_email', trim(v_entry.contact_email), 'manual', null,
        v_entry.submitted_by_user_id
      );
    end if;
    if nullif(trim(v_entry.address_line_1), '') is not null then
      perform public.record_field_source(
        v_organisation_id, 'address_line_1', trim(v_entry.address_line_1), 'manual', null,
        v_entry.submitted_by_user_id
      );
    end if;
    if nullif(trim(v_entry.city), '') is not null then
      perform public.record_field_source(
        v_organisation_id, 'city', trim(v_entry.city), 'manual', null,
        v_entry.submitted_by_user_id
      );
    end if;
    if nullif(trim(v_entry.postcode), '') is not null then
      perform public.record_field_source(
        v_organisation_id, 'postcode', trim(v_entry.postcode), 'manual', null,
        v_entry.submitted_by_user_id
      );
    end if;
    if v_entry.organisation_type is not null then
      perform public.record_field_source(
        v_organisation_id, 'organisation_type', v_entry.organisation_type::text, 'manual', null,
        v_entry.submitted_by_user_id
      );
    end if;
  end if;

  update public.manual_entry_records set
    converted_to_organisation_id = v_organisation_id,
    review_status = 'approved',
    reviewed_by_user_id = v_actor,
    reviewed_at = now(),
    review_notes = nullif(trim(p_notes), '')
  where id = p_entry_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_duplicate_decision = 'link_existing'
      then 'manual_entry_linked_existing' else 'manual_entry_approved' end,
    'organisations', v_organisation_id,
    jsonb_build_object(
      'manual_entry_id', p_entry_id,
      'submitted_by_user_id', v_entry.submitted_by_user_id,
      'organisation_type', v_entry.organisation_type,
      'duplicate_decision', p_duplicate_decision,
      'matched_organisation_id', v_match_organisation_id,
      'admin_confirmed_eligible', p_admin_confirmed_eligible,
      'notes', nullif(trim(p_notes), '')
    )
  );

  return v_organisation_id;
end;
$$;

comment on function public.approve_manual_entry(uuid,text,boolean,uuid,text) is
  'F036/F042 manual-entry approval, re-rewritten 20260923114000: on create_new, '
  'each populated tracked field is attributed via record_field_source '
  '(source=''manual'', recorded_by=the submitting CAM), so the record''s field '
  'history and Data Sources card say Manual Input from the person who entered it. '
  'link_existing writes no provenance: the linked record keeps whichever source '
  'produced its fields. Everything else unchanged from 20260817130000.';

revoke execute on function public.approve_manual_entry(uuid,text,boolean,uuid,text)
  from public, anon;
grant execute on function public.approve_manual_entry(uuid,text,boolean,uuid,text)
  to authenticated;
