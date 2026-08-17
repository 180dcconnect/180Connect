-- Migration: add_personal_data_exclusion
-- Sequence: extends the compliance layer added by 20260817130000_create_data_handling_rules
--   (F246). No new position in the Data Model sequence — same layer, second story.
-- Story: F247 Personal Data Exclusion (#242)
-- Spec: Technical Brief §5 Data & Legal Risks (1); docs/personal-data-exclusions.md
--
-- PURPOSE: F246 built a field-level deny-list. F247 answers the question F246's
--   issue left open ("which fields are banned") from the risk register, and closes
--   the two gaps that list exposes.
--
--   The risk register says the platform must not store "name of trustees, personal
--   email addresses ... in any way or form". F246 seeded neither. It denies home
--   addresses, dates of birth, nationality and aliases, and keeps every name.
--
--   The second gap is shape, not coverage. A personal email address on a scraped
--   website is not a field — it is a run of characters inside markup, and no path
--   names it. So this migration adds a second kind of rule that redacts *within* a
--   value instead of removing the value.
--
-- DESIGN — two additions:
--
--   1. `rule_kind` on DATA_HANDLING_RULES. 'field_path' is F246's behaviour and the
--      default, so every existing row keeps its meaning. 'redact_personal_email'
--      and 'redact_phone_number' name a detector implemented in
--      src/lib/ingestion/personal-data.ts; the row says which sources and which
--      field it runs against, which keeps the admin-editable-without-a-deploy
--      property F246 established. The regexes stay in code deliberately — a
--      pattern an admin can edit is a pattern an admin can hang ingestion with.
--
--   2. PERSONAL_EMAIL_ROLE_PARTS. Which local parts name a role (`info@`,
--      `fundraising@`) rather than a person. An allow-list, inverting F246's
--      deny-list, because the set worth keeping is small and closed while the set
--      worth removing is every name any human has — and because over-keeping
--      stores someone's address while over-removing costs a CAM one lookup.
--      A table rather than a constant because SQL and TypeScript both need it:
--      app.is_personal_email reads it, and so does the ingestion runner.
--
-- ALSO FIXES (F246, found while extending it): the partial unique index on
--   DATA_HANDLING_RULES did not constrain global rules. Postgres treats NULLs as
--   distinct, so two active rules with source = null and the same field_path both
--   inserted, and the duplicate refusal the admin screen relies on only ever
--   worked for source-specific rules. Rebuilt with NULLS NOT DISTINCT.
--
-- Schema change approval record (SOP §7):
--   Change        | Add rule_kind to DATA_HANDLING_RULES. Rebuild
--                 | data_handling_rules_active_unique as NULLS NOT DISTINCT and
--                 | over (source, field_path, rule_kind). Add
--                 | PERSONAL_EMAIL_ROLE_PARTS table. Add app.is_personal_email.
--                 | Replace create_data_handling_rule with a 5-argument form.
--                 | Add set_personal_email_role_part RPC. Seed F247 rules; bump
--                 | rule version. The MANUAL_ENTRY_RECORDS trigger this story also
--                 | needs is held for a follow-up migration — see §3's note.
--   Reason        | F247 (#242) — exclude private trustee/person data per the
--                 | Technical Brief risk register §5.
--   Compatibility | rule_kind defaults to 'field_path', so all 16 F246 rules keep
--                 | their behaviour unchanged. The unique index is narrowed, not
--                 | widened — it can only start refusing writes it should always
--                 | have refused, and the seed asserts no existing row violates it.
--   Data migration| Rows already in RAW_SOURCE_RECORDS are not touched here.
--                 | npm run backfill:data-handling-rules applies the new rules to
--                 | them, with a dry run first (F247 AC2). Deliberately not done
--                 | in this migration: it rewrites an unbounded number of rows.
--   Security      | PERSONAL_EMAIL_ROLE_PARTS: admin-only SELECT, no authenticated
--                 | writes, RPC-only mutation, audit-logged. Both new/replaced RPCs
--                 | are SECURITY DEFINER and self-check app.is_admin().
--   Documentation | docs/personal-data-exclusions.md; Data Model tabs 02, 03.
--   Approved by   | Pending — raised with Bashir (Project Leader) on 2026-08-17.
--
-- Reversibility: paired rollback in
-- ../rollback/20260817130200_add_personal_data_exclusion.down.sql

------------------------------------------------------------------------
-- 1. RULE KINDS
------------------------------------------------------------------------

alter table public.data_handling_rules
  add column rule_kind text not null default 'field_path'
    check (rule_kind in (
      'field_path',
      'redact_personal_email',
      'redact_phone_number'
    ));

-- A redaction rule keeps the field and changes what it says, so 'allow' has no
-- meaning for one. Without this an admin can create a rule that reads as an
-- exemption and silently does nothing.
alter table public.data_handling_rules
  add constraint data_handling_rules_redaction_denies check (
    rule_kind = 'field_path' or action = 'deny'
  );

comment on column public.data_handling_rules.rule_kind is
  '''field_path'' (F246) removes the field named by field_path outright. The '
  '''redact_*'' kinds (F247) keep the field and replace matches inside its string '
  'values, for personal data that is not a field of its own — an email address in '
  'a page of markup. For those, field_path names the field to scan, or ''*'' for '
  'every string in the payload. The detectors live in '
  'src/lib/ingestion/personal-data.ts; this column selects one.';

-- F246 fix. The original index was `on (source, field_path) where is_active`, and
-- Postgres's default NULLS DISTINCT meant every global rule (source = null) was
-- exempt from it: the same global field_path could be inserted any number of
-- times. rule_kind joins the key because a field can legitimately carry both a
-- removal rule and a redaction rule, and two redaction kinds at once.
drop index public.data_handling_rules_active_unique;

create unique index data_handling_rules_active_unique
  on public.data_handling_rules (source, field_path, rule_kind)
  nulls not distinct
  where (is_active = true);

------------------------------------------------------------------------
-- 2. ROLE EMAIL LOCAL PARTS
------------------------------------------------------------------------

create table public.personal_email_role_parts (
  local_part  text primary key
                check (local_part = lower(trim(local_part))
                       and length(local_part) between 2 and 64),
  reason      text not null,
  created_by  uuid references public.users (id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.personal_email_role_parts is
  'Email local parts that address a role rather than a named individual (F247). '
  'An address whose local part contains one of these as a word is kept; every '
  'other address is treated as personal and redacted. An allow-list rather than a '
  'deny-list because the role set is small and closed while the personal set is '
  'every human name — see src/lib/ingestion/personal-data.ts for the full '
  'reasoning. Read by app.is_personal_email and by the ingestion runner.';
comment on column public.personal_email_role_parts.local_part is
  'Lowercase, no surrounding whitespace. Matched against the words of an address''s '
  'local part after splitting on . _ - and +, so ''fundraising'' also keeps '
  '''fundraising.team@'' and ''info'' also keeps ''info-sheffield@''.';

create trigger personal_email_role_parts_set_updated_at
  before update on public.personal_email_role_parts
  for each row execute function public.set_updated_at();

revoke all on public.personal_email_role_parts from anon, authenticated;
grant select on public.personal_email_role_parts to authenticated;
grant select, insert, update on public.personal_email_role_parts to service_role;

alter table public.personal_email_role_parts enable row level security;

create policy personal_email_role_parts_select on public.personal_email_role_parts
  for select to authenticated
  using (app.is_admin() and app.is_active_user());

-- No INSERT / UPDATE / DELETE policy for authenticated — writes go through
-- set_personal_email_role_part below.

insert into public.personal_email_role_parts (local_part, reason) values
  ('info',            'Generic organisational inbox.'),
  ('contact',         'Generic organisational inbox.'),
  ('contactus',       'Generic organisational inbox.'),
  ('enquiries',       'Generic organisational inbox.'),
  ('enquiry',         'Generic organisational inbox.'),
  ('hello',           'Generic organisational inbox.'),
  ('mail',            'Generic organisational inbox.'),
  ('email',           'Generic organisational inbox.'),
  ('general',         'Generic organisational inbox.'),
  ('office',          'Generic organisational inbox.'),
  ('reception',       'Generic organisational inbox.'),
  ('admin',           'Administrative function, not a named person.'),
  ('team',            'Addresses a team.'),
  ('support',         'Function inbox.'),
  ('help',            'Function inbox.'),
  ('helpdesk',        'Function inbox.'),
  ('fundraising',     'Function inbox — the most common useful contact for outreach.'),
  ('donate',          'Function inbox.'),
  ('donations',       'Function inbox.'),
  ('giving',          'Function inbox.'),
  ('volunteer',       'Function inbox.'),
  ('volunteering',    'Function inbox.'),
  ('partnerships',    'Function inbox — directly relevant to 180DC outreach.'),
  ('press',           'Function inbox.'),
  ('media',           'Function inbox.'),
  ('comms',           'Function inbox.'),
  ('communications',  'Function inbox.'),
  ('marketing',       'Function inbox.'),
  ('events',          'Function inbox.'),
  ('bookings',        'Function inbox.'),
  ('finance',         'Function inbox.'),
  ('accounts',        'Function inbox.'),
  ('invoices',        'Function inbox.'),
  ('hr',              'Function inbox.'),
  ('recruitment',     'Function inbox.'),
  ('jobs',            'Function inbox.'),
  ('careers',         'Function inbox.'),
  ('safeguarding',    'Function inbox — statutory role, addressed by post not by name.'),
  ('trustees',        'Addresses the trustee board collectively, not a named trustee.'),
  ('board',           'Addresses the board collectively.'),
  ('chair',           'Addresses the office, not the individual holding it.'),
  ('secretary',       'Addresses the office, not the individual holding it.'),
  ('treasurer',       'Addresses the office, not the individual holding it.'),
  ('ceo',             'Addresses the office, not the individual holding it.'),
  ('director',        'Addresses the office, not the individual holding it.'),
  ('manager',         'Addresses the office, not the individual holding it.'),
  ('charity',         'Common self-referential organisational inbox.'),
  ('noreply',         'Automated sender; not a person and not useful, but not personal.'),
  ('reply',           'Covers ''no-reply@'' and ''do-not-reply@'', which split into words on the hyphen.');

------------------------------------------------------------------------
-- 3. app.is_personal_email
------------------------------------------------------------------------
-- The SQL half of the detector in src/lib/ingestion/personal-data.ts. Both read
-- PERSONAL_EMAIL_ROLE_PARTS, so the two agree by construction rather than by
-- somebody remembering to update a list in two places. The word-splitting rule
-- ('. _ - +') is the one piece of logic genuinely duplicated; it is one regex and
-- personal-data.test.ts asserts the same cases the pgTAP suite does.

create or replace function app.is_personal_email(p_address text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Not an address at all: not something this function has an opinion about.
  select case
    when p_address is null then false
    when position('@' in p_address) < 2 then false
    else not exists (
      select 1
        from unnest(
               regexp_split_to_array(
                 lower(split_part(p_address, '@', 1)),
                 '[._+-]'
               )
             ) as word
        join public.personal_email_role_parts role
          on role.local_part = word
       where role.is_active = true
    )
  end;
$$;

comment on function app.is_personal_email is
  'True when an email address names an individual rather than a role (F247). '
  'Unknown local parts count as personal — the allow-list direction. Used by the '
  'MANUAL_ENTRY_RECORDS trigger; the ingestion runner applies the same rule in '
  'TypeScript against the same table.';

-- NOT HERE: the MANUAL_ENTRY_RECORDS trigger.
--
-- F036 (a CAM types a contact address) and F037 (an import finds one) both write
-- MANUAL_ENTRY_RECORDS.contact_email, and AC3's "not implemented differently per
-- source" says the check belongs on the column both of them write, as a trigger —
-- a CHECK constraint cannot query PERSONAL_EMAIL_ROLE_PARTS.
--
-- It is not in this migration because MANUAL_ENTRY_RECORDS does not exist on this
-- branch. F036 is open at #360 against dev; F246, which this story extends, was
-- merged to main. No branch currently has both, so the trigger cannot be written
-- anywhere that would compile. It ships as
-- 20260817130300_block_personal_email_manual_entry.sql the moment they meet —
-- written and reviewed alongside this migration, held back rather than guarded
-- with a to_regclass check, because a conditionally-created compliance trigger is
-- one that silently does not exist on a fresh database.
--
-- app.is_personal_email below is that trigger's dependency, and is created here so
-- the detector lives with the table it reads.

------------------------------------------------------------------------
-- 4. RPCs
------------------------------------------------------------------------

-- 4a. create_data_handling_rule, now carrying rule_kind.
--
-- Dropped and recreated rather than CREATE OR REPLACE: adding a defaulted
-- parameter creates an overload rather than replacing the function, and a
-- four-argument call would then be ambiguous between the two.
drop function if exists public.create_data_handling_rule(text, text, text, text);

create or replace function public.create_data_handling_rule(
  p_source       text default null,
  p_field_path   text default null,
  p_action       text default 'deny',
  p_reason       text default null,
  p_rule_kind    text default 'field_path'
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

  if p_field_path is null or trim(p_field_path) = '' then
    raise exception 'field_path is required';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required';
  end if;
  if p_action not in ('allow', 'deny') then
    raise exception 'action must be ''allow'' or ''deny''';
  end if;
  if p_rule_kind not in
       ('field_path', 'redact_personal_email', 'redact_phone_number') then
    raise exception 'rule_kind must be ''field_path'', ''redact_personal_email'' or ''redact_phone_number''';
  end if;
  -- Mirrors the table constraint, so the admin screen gets a sentence rather than
  -- a constraint name.
  if p_rule_kind <> 'field_path' and p_action <> 'deny' then
    raise exception 'a redaction rule cannot be an allow rule — it changes what a field says, it does not exempt it';
  end if;

  update public.data_handling_rule_versions
    set current_version = current_version + 1,
        updated_at = now()
    where id = true
    returning current_version into v_new_version;

  insert into public.data_handling_rules
    (rule_version, source, field_path, action, reason, created_by, rule_kind)
  values
    (v_new_version,
     case when p_source is not null then p_source::public.data_source_name else null end,
     trim(p_field_path), p_action, trim(p_reason), v_actor, p_rule_kind)
  returning id into v_rule_id;

  insert into public.audit_log
    (actor_user_id, action, target_table, target_id, detail)
  values
    (v_actor, 'data_handling_rule_created', 'data_handling_rules', v_rule_id,
     jsonb_build_object(
       'source', p_source,
       'field_path', trim(p_field_path),
       'action', p_action,
       'rule_kind', p_rule_kind,
       'reason', trim(p_reason),
       'rule_version', v_new_version
     ));

  return v_rule_id;
end;
$$;

comment on function public.create_data_handling_rule is
  'Creates a data handling rule and bumps the global rule version (F246, F247). '
  'Admin-only, audit-logged. See docs/audit-log-pattern.md.';

revoke execute on function public.create_data_handling_rule(text, text, text, text, text)
  from public, anon;
grant execute on function public.create_data_handling_rule(text, text, text, text, text)
  to authenticated;

-- 4b. set_personal_email_role_part
--
-- Adding `safeguarding@` to the keep-list must not need a deploy — same property
-- F246 established for the rules themselves. Upsert rather than insert-or-error:
-- the useful admin action is "make sure this local part is kept", and a
-- previously-deactivated part reactivating is the same intent as a new one.
create or replace function public.set_personal_email_role_part(
  p_local_part text,
  p_is_active  boolean,
  p_reason     text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid;
  v_normalised text;
  v_was       boolean;
begin
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if not app.is_admin() then
    raise exception 'Only admins can change the role email list';
  end if;
  if not app.is_active_user() then
    raise exception 'Inactive users cannot change the role email list';
  end if;

  v_normalised := lower(trim(coalesce(p_local_part, '')));
  if v_normalised = '' then
    raise exception 'local_part is required';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required';
  end if;
  -- A local part with an @ in it is an address, and adding a whole address to a
  -- list of words would keep every address at that domain.
  if position('@' in v_normalised) > 0 then
    raise exception 'give the local part only, without the @ or the domain';
  end if;

  select is_active into v_was
    from public.personal_email_role_parts
    where local_part = v_normalised;

  -- No-op, per docs/audit-log-pattern.md §5: nothing changed, so nothing is logged.
  if v_was is not null and v_was = p_is_active then
    return;
  end if;

  insert into public.personal_email_role_parts
    (local_part, reason, created_by, is_active)
  values
    (v_normalised, trim(p_reason), v_actor, p_is_active)
  on conflict (local_part) do update
    set is_active  = excluded.is_active,
        reason     = excluded.reason,
        updated_at = now();

  insert into public.audit_log
    (actor_user_id, action, target_table, detail)
  values
    (v_actor,
     case when p_is_active then 'personal_email_role_part_added'
          else 'personal_email_role_part_removed' end,
     'personal_email_role_parts',
     jsonb_build_object(
       'local_part', v_normalised,
       'from_active', v_was,
       'to_active', p_is_active,
       'reason', trim(p_reason)
     ));
end;
$$;

comment on function public.set_personal_email_role_part is
  'Adds or retires an email local part from the role allow-list (F247). '
  'Admin-only, audit-logged, no-op safe.';

revoke execute on function public.set_personal_email_role_part(text, boolean, text)
  from public, anon;
grant execute on function public.set_personal_email_role_part(text, boolean, text)
  to authenticated;

------------------------------------------------------------------------
-- 5. SEED — the banned set, from the risk register
------------------------------------------------------------------------
-- Technical Brief §5, Data & Legal Risks (1): "if APIs can return private
-- information such name of trustees, personal email addresses, which shall not be
-- stored or used in any way or form". F246 seeded neither of those two. It denied
-- home address, date of birth, nationality and aliases — the surrounding fields —
-- and kept every name.
--
-- Field paths are checked against each API's documented response shape and
-- recorded in docs/personal-data-exclusions.md with the endpoint they came from.
-- Several name a field no adapter fetches today: none of the four live adapters
-- calls an officers or trustees endpoint. That is on purpose. A rule that exists
-- before the endpoint does is the only version of this control that is ever
-- ahead of the data, and the cost of a rule matching nothing is nothing.

update public.data_handling_rule_versions
  set current_version = current_version + 1, updated_at = now()
  where id = true;

-- Names. created_by null throughout: a migration-seeded rule has no human author,
-- the convention 20260817130100 established.
insert into public.data_handling_rules
  (rule_version, source, field_path, action, reason, rule_kind)
select
  (select current_version from public.data_handling_rule_versions where id = true),
  seed.source::public.data_source_name, seed.field_path, 'deny', seed.reason, 'field_path'
from (values
  ('companies_house', 'officers[*].name',
   'Officer name — risk register §5: a named individual''s details are not stored in any form. The company is the client; the person is not.'),
  ('companies_house', 'officers[*].occupation',
   'Officer occupation — personal detail about a named individual, no outreach purpose.'),
  ('companies_house', 'officers[*].address',
   'Officer address as returned by the officers endpoint. This is the correspondence address and is frequently the individual''s home. Distinct from the F246 rule on usual_residential_address, which names a field this API does not return.'),
  ('charity_commission', 'trustees[*].trustee_name',
   'Trustee name — risk register §5, named explicitly.'),
  ('charity_commission', 'trustees[*].name',
   'Trustee name under the alternative key the register uses on some endpoints.'),
  ('charitybase', 'trustees[*].name',
   'Trustee name — risk register §5, named explicitly.'),
  ('find_that_charity', 'trustees[*].name',
   'Trustee name — Find That Charity reconciles across registers and can carry trustee records forward from any of them.')
) as seed(source, field_path, reason);

-- Personal email addresses, everywhere, every source.
--
-- Global and '*' because there is no field to name: a personal address turns up in
-- a registry contact block, in a grant record's free text and in a page of markup,
-- and the register bans it in all three. The role allow-list is what stops this
-- taking the organisational address the platform exists to collect.
insert into public.data_handling_rules
  (rule_version, source, field_path, action, reason, rule_kind)
values
  ((select current_version from public.data_handling_rule_versions where id = true),
   null, '*', 'deny',
   'Personal email addresses — risk register §5, named explicitly. Redacted rather than removed because they occur inside values (markup, free text) that are themselves worth keeping. Addresses whose local part names a role are kept; see personal_email_role_parts.',
   'redact_personal_email');

-- Telephone numbers, on fetched web pages only.
--
-- Scoped by field rather than by source on purpose. A phone number from a registry
-- is the organisation's switchboard — published by the organisation, as the
-- organisation's contact, and something outreach legitimately needs. A number on a
-- charity's own web page may equally be a staff member's direct line or mobile,
-- and nothing in the markup distinguishes them.
--
-- 'html' is the field F037's stored page payload keeps its markup in. Naming the
-- field rather than the source means this rule needs no 'website' value in
-- data_source_name, which F037 adds on its own branch — the rule is inert on every
-- payload that has no html field, and starts working the day that branch lands,
-- with no cross-branch ordering to get right.
insert into public.data_handling_rules
  (rule_version, source, field_path, action, reason, rule_kind)
values
  ((select current_version from public.data_handling_rule_versions where id = true),
   null, 'html', 'deny',
   'Telephone numbers on a fetched web page. A registry-supplied number is the organisation''s switchboard and is kept; a number in a page of markup may be a direct line or a personal mobile and the markup does not say which.',
   'redact_phone_number');

insert into public.audit_log
  (actor_user_id, action, target_table, detail)
values
  (null, 'data_handling_rules_seeded', 'data_handling_rules',
   jsonb_build_object(
     'rule_version', (select current_version from public.data_handling_rule_versions where id = true),
     'rules_added', 9,
     'origin', 'migration_seed',
     'story', 'F247',
     'policy_reference', 'Technical Brief §5 Data & Legal Risks (1)'
   ));

-- Same stance as the F246 seed: a compliance rule set that silently ends up short
-- is worse than a failed migration, because the version number would then claim
-- an enforcement that is not in place. 16 from F246 plus 9 here.
do $$
declare
  v_total integer;
  v_redactions integer;
  v_roles integer;
begin
  select count(*) into v_total
    from public.data_handling_rules where is_active = true;
  select count(*) into v_redactions
    from public.data_handling_rules
    where is_active = true and rule_kind <> 'field_path';
  select count(*) into v_roles
    from public.personal_email_role_parts where is_active = true;

  if v_total <> 25 then
    raise exception
      'F247 seed failed: expected 25 active data handling rules, found %.', v_total;
  end if;
  if v_redactions <> 2 then
    raise exception
      'F247 seed failed: expected 2 active redaction rules, found %.', v_redactions;
  end if;
  if v_roles <> 49 then
    raise exception
      'F247 seed failed: expected 49 active role email local parts, found %.', v_roles;
  end if;
end;
$$;
