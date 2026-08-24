-- Migration: create_restricted_edit_fields
-- Story: F020 Restricted Editing (#23)
-- Spec: docs/rls-permission-matrix.md §3.2 (canonical data — shared read, admin write)
--
-- WHAT THIS IS: the configuration half of restricted editing. The six-field
--   sensitive allowlist that F077 hardcoded into edit_suggestions' CHECK constraint
--   and suggest_organisation_edit's body becomes data: one row per ORGANISATIONS
--   column that CAMs may not write directly. Seeded with the signed-off six
--   (legal_name, website, contact_email, address_line_1, city, postcode — Bashir +
--   Project Leader, 22 Aug 2026, #23; same list as FIELD_DISCREPANCIES/FIELD_SOURCES).
--
-- WHY A TABLE: #23's AC4 — "which fields count as sensitive is documented and
--   configurable, rather than hardcoded ambiguously into the UI." Until now the list
--   lived in three synced places (CHECK constraint, RPC body, SENSITIVE_ORG_FIELDS);
--   changing it meant a migration. Now an admin adds or retires a restricted field at
--   runtime, and every enforcement point reads this table.
--
-- SOFT-DISABLE, NEVER DELETE: rows are retired by flipping active = false. Two
--   reasons: edit_suggestions.field_name becomes a foreign key to this table (a
--   delete would orphan historical suggestions), and the audit trail of what *was*
--   restricted when is part of the point. Re-adding a retired field flips active
--   back on rather than inserting a duplicate row.
--
-- WHICH COLUMNS MAY BECOME RESTRICTED: only existing text columns of ORGANISATIONS
--   outside a small protected set (add_restricted_edit_field enforces this):
--   id / owner_id / created_at / updated_at (system), entry_method / is_seed /
--   is_verified / data_completeness_score (provenance & computed state),
--   outreach_status / owner_id writes already have their own audited paths,
--   country_code + is_international (tied by a CHECK pair),
--   organisation_type / geographic_reach (enum-typed). Everything text — including
--   future columns added by later migrations — is fair game.
--
-- WHO READS IT: admins (the management panel) and CAMs (so the suggest-edit UI and
--   the column-guard trigger agree with what the database will actually refuse).
--   Viewers have no write surface, so they get nothing.
--
-- WHO WRITES IT: nobody directly. add_restricted_edit_field /
--   deactivate_restricted_edit_field are SECURITY DEFINER, admin-only, audited —
--   changing this table changes who can write client records, which is approval-state
--   territory (docs/audit-log-pattern.md §1).
--
-- FK SWAP ON EDIT_SUGGESTIONS: the static CHECK constraint from
--   20260822140000 comes off; field_name now references this table. Same guarantee
--   (no suggestion for a field that isn't restricted) plus the new one (no
--   restriction row deleted out from under a historical suggestion).
--
-- Schema change approval record (SOP §7):
--   Change        | New table RESTRICTED_EDIT_FIELDS (+ seed of six); add and deactivate
--                 | RPCs; edit_suggestions.field_name CHECK replaced by FK;
--                 | suggest_organisation_edit rewritten to validate against the table.
--   Reason        | #23 AC4 — the sensitive-field allowlist must be configurable,
--                 | not hardcoded ambiguously into the UI.
--   Compatibility | suggest_organisation_edit keeps its signature, errcodes and
--                 | supersede/block behaviour — callers and TS error mapping are
--                 | untouched. The seeded six behave exactly as the old CHECK did.
--   Data migration| Seed inserts only; no existing rows transformed.
--   Security      | RLS on. SELECT: admins all rows, CAMs active rows, viewers none.
--                 | No INSERT/UPDATE/DELETE grant to authenticated — writes are the
--                 | SECURITY DEFINER RPCs below, self-checking app.is_admin() and
--                 | auditing both directions.
--   Documentation | Data Model tab 04 (RESTRICTED_EDIT_FIELDS) + tab 02 dictionary +
--                 | tab 11 sequence step 24.3; RLS matrix §3.2 gap paragraph.
--
-- Reversibility: paired rollback in ../rollback/20260822160000_create_restricted_edit_fields.down.sql

create table public.restricted_edit_fields (
  id         uuid primary key default gen_random_uuid(),
  -- An ORGANISATIONS column name. Unique because it is the FK target for
  -- edit_suggestions.field_name and the loop key in the column-guard trigger.
  field_name text not null unique,
  -- Retired fields stay as rows so history and FKs survive; only active rows are
  -- enforced by the trigger and accepted by suggest_organisation_edit.
  active     boolean not null default true,
  -- Why the field is restricted — shown in the admin panel next to the toggle.
  reason     text not null,
  -- Null = seeded by this migration before any user existed. Set by the add RPC
  -- afterwards.
  added_by   uuid references public.users (id),
  created_at timestamptz not null default now(),

  constraint restricted_edit_fields_reason_not_blank check (btrim(reason) <> '')
);

comment on table public.restricted_edit_fields is
  '#23 (F020): ORGANISATIONS columns a CAM may not write directly — corrections go '
  'through suggest_organisation_edit and an admin decision. Enforced by the '
  'organisations column-guard trigger; configured here by admins, audited both ways.';
comment on column public.restricted_edit_fields.active is
  'False = retired: the trigger ignores the field and new suggestions are refused, '
  'but historical suggestions and the row itself remain. Never delete.';
comment on column public.restricted_edit_fields.reason is
  'Why this field is restricted. Required so the admin panel shows intent, not just '
  'a list.';
comment on column public.restricted_edit_fields.added_by is
  'Admin who added/re-added the restriction. Null for the six system-seeded fields.';

-- The signed-off sensitive six (#23, 22 Aug 2026) — identical to the CHECK constraint
-- this migration replaces on edit_suggestions.
insert into public.restricted_edit_fields (field_name, reason) values
  ('legal_name',     'Signed-off sensitive field: externally verifiable identity — a wrong value corrupts dedup and outreach targeting.'),
  ('website',        'Signed-off sensitive field: drives booklet generation and Find-that-Charity matching.'),
  ('contact_email',  'Signed-off sensitive field: outreach is addressed to it.'),
  ('address_line_1', 'Signed-off sensitive field: postal identity used by imports and dedup.'),
  ('city',           'Signed-off sensitive field: geography targeting and priority scoring read it.'),
  ('postcode',       'Signed-off sensitive field: geography targeting and dedup read it.');

-- Revoke before grant (MIGRATIONS.md RLS recipe step 1). No INSERT/UPDATE/DELETE to
-- anyone: configuration changes go through the two SECURITY DEFINER RPCs below.
revoke all on public.restricted_edit_fields from anon, authenticated;
grant select on public.restricted_edit_fields to authenticated;

alter table public.restricted_edit_fields enable row level security;

create policy restricted_edit_fields_select_admin on public.restricted_edit_fields
  for select to authenticated
  using (
    app.is_active_user()
    and (
      app.is_admin()
      -- CAMs need the live list so the suggest-edit UI offers exactly the fields the
      -- database will accept; retired rows are none of their business.
      or (app.is_cam() and active)
    )
  );

-- ---------------------------------------------------------------------------
-- add_restricted_edit_field — admin puts a column under restriction
-- ---------------------------------------------------------------------------

create or replace function public.add_restricted_edit_field(
  p_field_name text,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_field  text := btrim(coalesce(p_field_name, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id     uuid;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_admin() then
    raise exception 'only an admin may change restricted editing'
      using errcode = '42501';
  end if;

  if v_reason = '' then
    raise exception 'a reason is required — the admin panel shows why a field is locked'
      using errcode = '23514';
  end if;

  -- Only real text columns of organisations may be restricted. information_schema
  -- (not a catalog poke at pg_attribute) so a renamed/dropped column simply fails
  -- the lookup. The protected set below covers system, provenance and enum-typed
  -- columns whose writes already have their own audited or constrained paths.
  if v_field in (
    'id', 'owner_id', 'created_at', 'updated_at',
    'entry_method', 'is_seed', 'is_verified', 'data_completeness_score',
    'outreach_status', 'country_code', 'is_international',
    'organisation_type', 'geographic_reach'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'organisations'
       and column_name  = v_field
       and data_type    = 'text'
  ) then
    raise exception '% is not a restrictable client field', coalesce(nullif(v_field, ''), '(blank)')
      using errcode = '23514';
  end if;

  -- Re-adding a retired field reactivates it instead of duplicating the row.
  insert into public.restricted_edit_fields (field_name, reason, added_by)
  values (v_field, v_reason, v_actor)
  on conflict (field_name) do update
    set active   = true,
        reason   = excluded.reason,
        added_by = excluded.added_by
  returning id into v_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'restricted_field_added', 'organisations', null,
    jsonb_build_object('field', v_field, 'reason', v_reason)
  );

  return v_id;
end;
$$;

comment on function public.add_restricted_edit_field(text, text) is
  '#23 (F020): admin-only. Puts an existing text column of organisations under '
  'restricted editing: CAMs can no longer save it directly (column-guard trigger) and '
  'corrections must go through suggest_organisation_edit. Re-adding a retired field '
  'reactivates it. Audits restricted_field_added. SECURITY DEFINER; self-checks '
  'app.is_admin().';

revoke execute on function public.add_restricted_edit_field(text, text) from public;
revoke execute on function public.add_restricted_edit_field(text, text) from anon;
grant execute on function public.add_restricted_edit_field(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- deactivate_restricted_edit_field — admin retires a restriction (soft-disable)
-- ---------------------------------------------------------------------------

create or replace function public.deactivate_restricted_edit_field(
  p_field_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_field text := btrim(coalesce(p_field_name, ''));
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_admin() then
    raise exception 'only an admin may change restricted editing'
      using errcode = '42501';
  end if;

  update public.restricted_edit_fields
     set active = false
   where field_name = v_field
     and active
  returning field_name into v_field;

  if v_field is null then
    raise exception 'no active restriction found for %', coalesce(nullif(btrim(coalesce(p_field_name, '')), ''), '(blank)')
      using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'restricted_field_removed', 'organisations', null,
    jsonb_build_object('field', v_field)
  );
end;
$$;

comment on function public.deactivate_restricted_edit_field(text) is
  '#23 (F020): admin-only. Retires a restriction by setting active = false — the row '
  'stays (FK target for edit_suggestions, and the history of what was restricted). '
  'Audits restricted_field_removed. SECURITY DEFINER; self-checks app.is_admin().';

revoke execute on function public.deactivate_restricted_edit_field(text) from public;
revoke execute on function public.deactivate_restricted_edit_field(text) from anon;
grant execute on function public.deactivate_restricted_edit_field(text) to authenticated;

-- ---------------------------------------------------------------------------
-- edit_suggestions.field_name: static CHECK -> foreign key to the config
-- ---------------------------------------------------------------------------

alter table public.edit_suggestions
  drop constraint edit_suggestions_field_name_check;

alter table public.edit_suggestions
  add constraint edit_suggestions_field_name_fkey
  foreign key (field_name) references public.restricted_edit_fields (field_name);

-- ---------------------------------------------------------------------------
-- suggest_organisation_edit — same contract, config-driven validation
-- ---------------------------------------------------------------------------

-- Rewritten from 20260822140000 with two changes and nothing else:
--   1. the inline six-field allowlist check becomes a lookup against
--      restricted_edit_fields where active (same errcode 23514, same message shape);
--   2. the case-per-column snapshot becomes to_jsonb(row) ->> field, which reads any
--      configured column without dynamic SQL. Signature, errcodes, supersede-own /
--      block-others logic and "no audit on submission" are unchanged.

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

  -- F020: the allowlist is the config table, not this body. Inactive rows refuse
  -- too — a retired restriction stops accepting new suggestions immediately.
  if not exists (
    select 1
      from public.restricted_edit_fields
     where field_name = v_field
       and active
  ) then
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

  -- Snapshot what this suggestion would really replace (AC2), straight off the row.
  -- jsonb key extraction instead of the old case-per-column select: the restricted
  -- set is data now, and this needs no dynamic SQL to follow it.
  select to_jsonb(o) ->> v_field
    into v_current
    from public.organisations o
   where o.id = p_organisation_id;

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
  '#79 (F077), rewritten by F020 (#23): a CAM proposes a correction to a restricted '
  'client field. The allowed set now comes from restricted_edit_fields (active rows) '
  'instead of an inline list, and the value snapshot uses jsonb extraction so any '
  'configured column works. Snapshots server-side, supersedes the caller''s own '
  'pending suggestion, refuses while another CAM''s is pending. Writes nothing to '
  'organisations and no audit_log row. SECURITY DEFINER; self-checks app.is_cam().';
