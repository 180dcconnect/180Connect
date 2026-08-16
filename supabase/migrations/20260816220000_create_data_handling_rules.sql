-- Migration: create_data_handling_rules
-- Sequence: addition to the Data Model migration sequence (compliance layer,
--   sits after step 22.x ingestion infrastructure — needs ingestion_runs,
--   raw_source_records, and public.data_source_name to exist).
-- Story: F246 Public Data Handling Rules (#241)
-- Spec: docs/data-handling-policy.md §2
--
-- PURPOSE: implements the field-level rule set described in the data handling
--   policy §2: "a field-level rule set, held in the database and editable by an
--   admin, is applied at the single point where external data enters the platform.
--   A field the rules exclude is discarded before it is written, even where the
--   source API returns it, and the record notes which fields were removed and under
--   which version of the rules."
--
-- DESIGN: deny-list, not allow-list. An allow-list would require enumerating every
--   field from every API and break each time a source adds a field. A deny-list
--   says "store everything except these fields" — matching the policy's intent.
--   source = null means the rule applies to ALL sources; a source-specific rule
--   wins over a global rule for that source.
--
-- VERSION TRACKING: every mutation bumps a monotonic version number held in
--   data_handling_rule_versions. Ingestion records which version was in force when
--   a record was written (raw_source_records.rule_version_applied), satisfying
--   the policy's "under which version of the rules."
--
-- WRITE PATH: no INSERT/UPDATE/DELETE policy for authenticated. Every write goes
--   through create_data_handling_rule / set_data_handling_rule_active — both
--   SECURITY DEFINER RPCs that self-check app.is_admin() and write audit_log in
--   the same transaction (docs/audit-log-pattern.md).
--
-- Schema change approval record (SOP §7):
--   Change        | Add DATA_HANDLING_RULES table (created_by nullable — a
--                 | migration-seeded rule has no human author),
--                 | DATA_HANDLING_RULE_VERSIONS singleton, two SECURITY DEFINER
--                 | RPCs. Add excluded_fields and rule_version_applied to
--                 | RAW_SOURCE_RECORDS.
--   Reason        | F246 — admin-editable rules defining which fields from
--                 | external sources are acceptable to store (#241).
--   Compatibility | New tables. Two new nullable columns on RAW_SOURCE_RECORDS
--                 | (excluded_fields jsonb, rule_version_applied integer) — no
--                 | impact on existing reads or writes, both default null.
--   Data migration| None. Existing raw_source_records rows keep null for the
--                 | new columns — they were written before rules existed.
--   Security      | RLS on DATA_HANDLING_RULES: admin-only SELECT; no
--                 | INSERT/UPDATE/DELETE for authenticated — writes via RPCs.
--                 | DATA_HANDLING_RULE_VERSIONS: admin-only SELECT, no writes.
--                 | RAW_SOURCE_RECORDS: existing policies unchanged.
--   Documentation | Update Data Model tab 03 + tab 02 Data Dictionary.
--
-- Reversibility: paired rollback in ../rollback/20260816220000_create_data_handling_rules.down.sql

------------------------------------------------------------------------
-- 1. VERSION TRACKER (singleton row)
------------------------------------------------------------------------
-- A single-row table is simpler and more transparent than a sequence for this
-- use case: the version is readable by admins, auditable, and participates in
-- normal RLS — a sequence is invisible to PostgREST and awkward to read via RPC.
-- The check constraint guarantees exactly one row.

create table public.data_handling_rule_versions (
  id              boolean primary key default true check (id = true),
  current_version integer not null default 0,
  updated_at      timestamptz not null default now()
);

comment on table public.data_handling_rule_versions is
  'Singleton: the current version of the data handling rule set (F246). Bumped '
  'by create_data_handling_rule and set_data_handling_rule_active. Read by the '
  'ingestion runner to stamp raw_source_records.rule_version_applied.';

insert into public.data_handling_rule_versions (id, current_version) values (true, 0);

-- Privileges: admin-only read, no authenticated writes.
revoke all on public.data_handling_rule_versions from anon, authenticated;
grant select on public.data_handling_rule_versions to authenticated;
grant select, update on public.data_handling_rule_versions to service_role;

alter table public.data_handling_rule_versions enable row level security;

create policy rule_versions_select on public.data_handling_rule_versions
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

------------------------------------------------------------------------
-- 2. RULES TABLE
------------------------------------------------------------------------

create table public.data_handling_rules (
  id              uuid primary key default gen_random_uuid(),
  rule_version    integer not null,
  source          public.data_source_name,          -- null = applies to ALL sources
  field_path      text not null,                     -- JSON path, e.g. 'officers[*].usual_residential_address'
  action          text not null default 'deny'
                    check (action in ('allow', 'deny')),
  reason          text not null,
  -- Nullable: a rule seeded by a migration has no human author, and forcing one
  -- would mean either inventing a user or skipping the seed on a database with no
  -- admin yet. Null reads as "the platform", matching audit_log.actor_user_id.
  created_by      uuid references public.users (id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.data_handling_rules is
  'Field-level rules defining which fields from external API responses may or '
  'may not be stored in raw_source_records (F246). Deny-list model: everything '
  'is stored unless a deny rule matches the field path. Rules with source = null '
  'apply to all sources; a source-specific rule overrides a global one. Written '
  'only by create_data_handling_rule / set_data_handling_rule_active RPCs.';
comment on column public.data_handling_rules.source is
  'Null means the rule applies to every source. A non-null value restricts the '
  'rule to that single source. When both a global and a source-specific rule '
  'match the same field_path, the source-specific rule takes precedence.';
comment on column public.data_handling_rules.field_path is
  'Dot-separated path into the raw_payload JSON object. Array wildcards use '
  '[*] — e.g. ''officers[*].usual_residential_address'' strips that field from '
  'every element of the officers array. Paths are case-sensitive and must match '
  'the API''s actual field naming.';
comment on column public.data_handling_rules.rule_version is
  'The version number at which this rule was created or last toggled. Not the '
  'version that created it — the global version at the time of the write.';
comment on column public.data_handling_rules.created_by is
  'The admin who created the rule. Null means the rule was seeded by a migration '
  'rather than authored by a person — the same convention as audit_log.actor_user_id. '
  'The create_data_handling_rule RPC always sets a real user.';
comment on column public.data_handling_rules.action is
  '''deny'' = strip this field before writing; ''allow'' = explicitly permit it '
  '(useful to override a global deny for a specific source).';

-- Unique constraint: one active rule per (source, field_path) combination.
-- Inactive rules are kept for history and may have duplicates.
create unique index data_handling_rules_active_unique
  on public.data_handling_rules (source, field_path)
  where (is_active = true);

-- Index for the runner's load: active rules only, optionally filtered by source.
create index data_handling_rules_active_source_idx
  on public.data_handling_rules (source)
  where (is_active = true);

-- Privileges: admin-only read, no authenticated writes.
revoke all on public.data_handling_rules from anon, authenticated;
grant select on public.data_handling_rules to authenticated;
grant select, insert, update on public.data_handling_rules to service_role;

alter table public.data_handling_rules enable row level security;

create policy data_handling_rules_select on public.data_handling_rules
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

-- No INSERT / UPDATE / DELETE policy for authenticated — all writes go through
-- the SECURITY DEFINER RPCs below.

------------------------------------------------------------------------
-- 3. EXTEND RAW_SOURCE_RECORDS
------------------------------------------------------------------------
-- Two new nullable columns: what was stripped and which rule version was in force.
-- Null means "written before rules existed" (all existing rows).

alter table public.raw_source_records
  add column excluded_fields jsonb,
  add column rule_version_applied integer;

comment on column public.raw_source_records.excluded_fields is
  'JSON array of field paths that were stripped from raw_payload before writing, '
  'per the active data handling rules at the time of ingestion (F246). Null for '
  'records written before rules existed. Empty array [] means rules were checked '
  'but nothing was stripped.';
comment on column public.raw_source_records.rule_version_applied is
  'The data_handling_rule_versions.current_version that was in force when this '
  'record was written. Null for records written before rules existed.';

------------------------------------------------------------------------
-- 4. RPCs — audited, admin-only writes
------------------------------------------------------------------------

-- 4a. create_data_handling_rule
create or replace function public.create_data_handling_rule(
  p_source       text default null,
  p_field_path   text default null,
  p_action       text default 'deny',
  p_reason       text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_new_version integer;
  v_rule_id     uuid;
begin
  -- Auth check
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if not app.is_admin() then
    raise exception 'Only admins can create data handling rules';
  end if;
  if not app.is_active_user() then
    raise exception 'Inactive users cannot create data handling rules';
  end if;

  -- Validate inputs
  if p_field_path is null or trim(p_field_path) = '' then
    raise exception 'field_path is required';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required';
  end if;
  if p_action not in ('allow', 'deny') then
    raise exception 'action must be ''allow'' or ''deny''';
  end if;

  -- Bump version
  update public.data_handling_rule_versions
    set current_version = current_version + 1,
        updated_at = now()
    where id = true
    returning current_version into v_new_version;

  -- Insert rule
  insert into public.data_handling_rules
    (rule_version, source, field_path, action, reason, created_by)
  values
    (v_new_version,
     case when p_source is not null then p_source::public.data_source_name else null end,
     trim(p_field_path), p_action, trim(p_reason), v_actor)
  returning id into v_rule_id;

  -- Audit log
  insert into public.audit_log
    (actor_user_id, action, target_table, target_id, detail)
  values
    (v_actor, 'data_handling_rule_created', 'data_handling_rules', v_rule_id,
     jsonb_build_object(
       'source', p_source,
       'field_path', trim(p_field_path),
       'action', p_action,
       'reason', trim(p_reason),
       'rule_version', v_new_version
     ));

  return v_rule_id;
end;
$$;

comment on function public.create_data_handling_rule is
  'Creates a new data handling rule and bumps the global rule version (F246). '
  'Admin-only, audit-logged. See docs/audit-log-pattern.md.';

revoke execute on function public.create_data_handling_rule from public, anon;
grant execute on function public.create_data_handling_rule to authenticated;

-- 4b. set_data_handling_rule_active
create or replace function public.set_data_handling_rule_active(
  p_rule_id    uuid,
  p_is_active  boolean,
  p_reason     text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid;
  v_new_version  integer;
  v_old_active   boolean;
  v_field_path   text;
  v_source       text;
  v_rule_action  text;
begin
  -- Auth check
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if not app.is_admin() then
    raise exception 'Only admins can modify data handling rules';
  end if;
  if not app.is_active_user() then
    raise exception 'Inactive users cannot modify data handling rules';
  end if;

  -- Load existing state
  select is_active, field_path, source, action
    into v_old_active, v_field_path, v_source, v_rule_action
    from public.data_handling_rules
    where id = p_rule_id;

  if not found then
    raise exception 'Rule not found: %', p_rule_id;
  end if;

  -- No-op check (audit-log-pattern.md §5)
  if v_old_active = p_is_active then
    return;
  end if;

  -- Bump version
  update public.data_handling_rule_versions
    set current_version = current_version + 1,
        updated_at = now()
    where id = true
    returning current_version into v_new_version;

  -- Update rule
  update public.data_handling_rules
    set is_active = p_is_active,
        rule_version = v_new_version,
        updated_at = now()
    where id = p_rule_id;

  -- Audit log
  insert into public.audit_log
    (actor_user_id, action, target_table, target_id, detail)
  values
    (v_actor,
     case when p_is_active then 'data_handling_rule_reactivated'
          else 'data_handling_rule_deactivated' end,
     'data_handling_rules', p_rule_id,
     jsonb_build_object(
       'source', v_source,
       'field_path', v_field_path,
       'action', v_rule_action,
       'from_active', v_old_active,
       'to_active', p_is_active,
       'reason', coalesce(trim(p_reason), ''),
       'rule_version', v_new_version
     ));
end;
$$;

comment on function public.set_data_handling_rule_active is
  'Activates or deactivates a data handling rule and bumps the global rule '
  'version (F246). Admin-only, audit-logged. No-ops (same state) are skipped. '
  'See docs/audit-log-pattern.md.';

revoke execute on function public.set_data_handling_rule_active from public, anon;
grant execute on function public.set_data_handling_rule_active to authenticated;
