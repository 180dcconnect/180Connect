-- Migration: contact_email_shared_inbox_override
-- Story: F247 Personal Data Exclusion (#242) follow-up — fewer false positives on
--   the manual-entry contact email, and a recorded way past the rest.
-- Sequence: addition to 20260818100400 / 20260818100500 (F247) and
--   20261002095000 (the current save_manual_entry). Data Model tab 03
--   MANUAL_ENTRY_RECORDS gains three optional columns — see the approval record.
--
-- ── Why ──
--
-- app.is_personal_email is an allow-list: an address is personal unless a word of
-- its local part is a known role (info, contact, hello, …). That direction is right
-- for Technical Brief §5, but it blocks every shared inbox named some other way —
-- wakamate@wakamate.ng was refused as "a personal address", and the only way past
-- was an admin adding 'wakamate' to the global role list.
--
-- ── 1. The organisation's own name is a role ──
--
-- A local part that is one of the address's own domain labels names the
-- organisation, not a person: wakamate@wakamate.ng, waka.mate@wakamate.co.uk.
-- The detector now keeps those. The TLD (the last label) never counts, and
-- neither do labels shorter than three characters or generic ones (www, mail,
-- email, com, org, net, gov, edu, ltd, plc) — so com@example.com stays personal.
-- jane@wakamate.ng stays personal: 'jane' is not the domain.
--
-- The TypeScript twin in src/lib/ingestion/personal-data.ts applies the identical
-- rule (same label filters), so ingestion redaction and this trigger still agree
-- by construction. Accepted edge: a person's vanity domain (jane@jane.me) now
-- passes. A named person almost never owns a domain that is exactly their first
-- name, and the override below is recorded either way.
--
-- ── 2. A recorded confirmation for everything else ──
--
-- When the detector still says personal, the submitter can confirm the address is
-- a shared organisation inbox. save_manual_entry records that confirmation — the
-- exact (lower-cased) address, who, when — and the trigger lets that address
-- through. It is not a switch on the row:
--   * it is bound to the address confirmed, so changing the email voids it;
--   * it is set only through the SECURITY DEFINER RPC (writes to this table are
--     RPC-only), with the caller as confirmer — it cannot be forged for someone
--     else;
--   * a new confirmation writes audit_log 'manual_entry_contact_email_role_confirmed'
--     (docs/audit-log-pattern.md: it changes what an approval may accept). The
--     audit detail holds the domain only, never the address — the log must not
--     become a second copy of possibly-personal data;
--   * a CAM's submission still reaches an admin, and the review queue shows
--     "Shared inbox confirmed by …" so that check is made by a second person.
--
-- Schema change approval record (SOP §7):
--   Change        | MANUAL_ENTRY_RECORDS + contact_email_role_confirmed_for text,
--                 | contact_email_role_confirmed_by uuid → users,
--                 | contact_email_role_confirmed_at timestamptz (all-or-none).
--                 | app.is_personal_email gains the domain-label rule.
--                 | check_manual_entry_contact_email honours a matching
--                 | confirmation. save_manual_entry gains
--                 | p_contact_email_role_confirmed (default false).
--   Reason        | Shared inboxes named other than by a role word were refused
--                 | outright, with no recorded route past the block.
--   Compatibility | Additive. The new parameter defaults to false, so existing
--                 | callers (the server action, the pgTAP suite's positional
--                 | calls) behave exactly as before. No RLS change; the columns
--                 | inherit the table's existing policies.
--   Data migration| None — existing rows have no confirmation.
--   Security      | Confirmation settable only via the RPC as the caller;
--                 | audited; bound to one address; reviewed by an admin for CAM
--                 | submissions.
--   Documentation | docs/personal-data-exclusions.md updated. Data Model tab 03
--                 | (xlsx) needs the three columns added before this merges.
--                 | Pending review by Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20261003130000_contact_email_shared_inbox_override.down.sql

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.manual_entry_records
  add column contact_email_role_confirmed_for text
    check (contact_email_role_confirmed_for is null
           or contact_email_role_confirmed_for = lower(trim(contact_email_role_confirmed_for))),
  add column contact_email_role_confirmed_by uuid
    references public.users(id) on delete set null,
  add column contact_email_role_confirmed_at timestamptz,
  add constraint manual_entry_role_confirmation_complete check (
    (contact_email_role_confirmed_for is null and contact_email_role_confirmed_at is null)
    or (contact_email_role_confirmed_for is not null and contact_email_role_confirmed_at is not null)
  );

comment on column public.manual_entry_records.contact_email_role_confirmed_for is
  'F247 override: the lower-cased contact_email a submitter confirmed is a shared '
  'organisation inbox. Honoured only while it equals the current contact_email.';
comment on column public.manual_entry_records.contact_email_role_confirmed_by is
  'Who confirmed contact_email_role_confirmed_for. Null after that user is deleted.';
comment on column public.manual_entry_records.contact_email_role_confirmed_at is
  'When contact_email_role_confirmed_for was confirmed.';

-- ---------------------------------------------------------------------------
-- 2. Detector: the organisation's own domain label is a role
-- ---------------------------------------------------------------------------
create or replace function app.is_personal_email(p_address text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with parts as (
    select lower(split_part(p_address, '@', 1)) as local_part,
           lower(substring(p_address from '@([^@]*)$')) as domain
  ),
  words as (
    select word
      from parts,
           unnest(regexp_split_to_array(parts.local_part, '[._+-]')) as word
     where word <> ''
  ),
  labels as (
    -- Every domain label but the last (the TLD), minus short and generic ones.
    select label
      from parts,
           unnest(
             (string_to_array(parts.domain, '.'))
               [1:greatest(coalesce(cardinality(string_to_array(parts.domain, '.')), 0) - 1, 0)]
           ) as label
     where length(label) >= 3
       and label not in ('www', 'mail', 'email', 'com', 'org', 'net', 'gov', 'edu', 'ltd', 'plc')
  )
  select case
    when p_address is null then false
    when position('@' in p_address) < 2 then false
    else not (
      exists (
        select 1
          from words
          join public.personal_email_role_parts role on role.local_part = words.word
         where role.is_active = true
      )
      or exists (select 1 from words join labels on labels.label = words.word)
      or exists (
        select 1
          from labels, parts
         where labels.label = regexp_replace(parts.local_part, '[._+-]', '', 'g')
      )
    )
  end;
$$;

comment on function app.is_personal_email is
  'True when an email address names an individual rather than a role (F247). '
  'Unknown local parts count as personal — the allow-list direction — except a '
  'local part naming one of the address''s own domain labels (20261003130000). '
  'Used by the MANUAL_ENTRY_RECORDS trigger; the ingestion runner applies the same '
  'rule in TypeScript against the same table.';

-- ---------------------------------------------------------------------------
-- 3. Trigger: a confirmation for this exact address lets it through
-- ---------------------------------------------------------------------------
create or replace function public.check_manual_entry_contact_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.contact_email is not null
     and app.is_personal_email(NEW.contact_email)
     and NEW.contact_email_role_confirmed_for is distinct from lower(trim(NEW.contact_email)) then
    raise exception 'personal email addresses are not permitted: contact_email must be a role address'
      using errcode = '22023';
  end if;
  return NEW;
end;
$$;

comment on function public.check_manual_entry_contact_email is
  'Trigger function enforcing personal email exclusion on manual_entry_records (F247 AC3). '
  'Honours a shared-inbox confirmation recorded for the same address (20261003130000).';

-- ---------------------------------------------------------------------------
-- 4. save_manual_entry: records the confirmation
-- ---------------------------------------------------------------------------
-- A new signature, not a replace: an extra parameter is a different function to
-- Postgres, and leaving the twenty-argument one beside it would make calls
-- ambiguous (same reasoning as 20261002095000).
drop function public.save_manual_entry(
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean,text,public.geographic_reach,numeric,date,integer,integer
);

create function public.save_manual_entry(
  p_entry_id uuid,
  p_legal_name text,
  p_mission_statement text,
  p_organisation_type public.organisation_type,
  p_address_line_1 text,
  p_city text,
  p_postcode text,
  p_country_code text,
  p_website text,
  p_contact_email text,
  p_registry_name text,
  p_registry_number text,
  p_reason text,
  p_submit boolean,
  p_sector text default null,
  p_geographic_reach public.geographic_reach default null,
  p_latest_income numeric default null,
  p_accounts_year_end date default null,
  p_staff_count integer default null,
  p_volunteer_count integer default null,
  p_contact_email_role_confirmed boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_existing public.manual_entry_records%rowtype;
  v_status public.manual_review_status := case when p_submit is true then 'pending' else 'draft' end;
  v_email text := nullif(trim(p_contact_email), '');
  v_confirmed_for text;
  v_confirmed_by uuid;
  v_confirmed_at timestamptz;
  v_newly_confirmed boolean := false;
begin
  if not app.can_write() then
    raise exception 'CAM or admin access required' using errcode = '42501';
  end if;

  if p_submit is true and (
    nullif(trim(p_legal_name), '') is null
    or nullif(trim(p_mission_statement), '') is null
    or p_organisation_type is null
    or nullif(trim(p_address_line_1), '') is null
    or nullif(trim(p_city), '') is null
    or nullif(trim(p_postcode), '') is null
    or nullif(trim(p_country_code), '') is null
    or nullif(trim(p_website), '') is null
    or nullif(trim(p_contact_email), '') is null
    or nullif(trim(p_registry_name), '') is null
    or nullif(trim(p_registry_number), '') is null
    or nullif(trim(p_reason), '') is null
  ) then
    raise exception 'complete every required manual-entry field before submission' using errcode = '22023';
  end if;

  -- Size figures describe a set of accounts, so they need the year end they are
  -- from — a financial period cannot be filed without one. Checked here for the
  -- message; the table's CHECK constraint is the boundary that holds.
  if (p_latest_income is not null or p_staff_count is not null or p_volunteer_count is not null)
     and p_accounts_year_end is null then
    raise exception 'add the accounts year end the size figures are from' using errcode = '22023';
  end if;
  if p_accounts_year_end is not null and p_accounts_year_end > current_date then
    raise exception 'the accounts year end cannot be in the future' using errcode = '22023';
  end if;

  if p_entry_id is not null then
    select * into v_existing
      from public.manual_entry_records
     where id = p_entry_id
     for update;
    if v_existing.id is null
       or v_existing.submitted_by_user_id <> v_actor
       or v_existing.review_status <> 'draft' then
      raise exception 'this draft is not available to edit' using errcode = '42501';
    end if;
  end if;

  -- 20261003130000: the shared-inbox confirmation. Ticked on every save it should
  -- hold for (the form pre-ticks a reopened confirmed draft), stored only for an
  -- address the detector would otherwise refuse, and bound to that address. An
  -- unchanged confirmation keeps its original confirmer and time.
  if p_contact_email_role_confirmed is true
     and v_email is not null
     and app.is_personal_email(v_email) then
    v_confirmed_for := lower(v_email);
    if v_existing.contact_email_role_confirmed_for = v_confirmed_for then
      v_confirmed_by := v_existing.contact_email_role_confirmed_by;
      v_confirmed_at := v_existing.contact_email_role_confirmed_at;
    else
      v_confirmed_by := v_actor;
      v_confirmed_at := now();
      v_newly_confirmed := true;
    end if;
  end if;

  if p_entry_id is not null then
    update public.manual_entry_records set
      legal_name = nullif(trim(p_legal_name), ''),
      mission_statement = nullif(trim(p_mission_statement), ''),
      organisation_type = p_organisation_type,
      address_line_1 = nullif(trim(p_address_line_1), ''),
      city = nullif(trim(p_city), ''),
      postcode = nullif(trim(p_postcode), ''),
      country_code = nullif(upper(trim(p_country_code)), ''),
      website = nullif(trim(p_website), ''),
      contact_email = v_email,
      contact_email_role_confirmed_for = v_confirmed_for,
      contact_email_role_confirmed_by = v_confirmed_by,
      contact_email_role_confirmed_at = v_confirmed_at,
      registry_name = nullif(trim(p_registry_name), ''),
      registry_number = nullif(trim(p_registry_number), ''),
      reason_for_manual_entry = nullif(trim(p_reason), ''),
      sector = nullif(trim(p_sector), ''),
      geographic_reach = p_geographic_reach,
      latest_income = p_latest_income,
      accounts_year_end = p_accounts_year_end,
      staff_count = p_staff_count,
      volunteer_count = p_volunteer_count,
      review_status = v_status
    where id = p_entry_id
    returning id into v_id;
  else
    insert into public.manual_entry_records (
      submitted_by_user_id, legal_name, mission_statement, organisation_type,
      address_line_1, city, postcode, country_code, website, contact_email,
      contact_email_role_confirmed_for, contact_email_role_confirmed_by, contact_email_role_confirmed_at,
      registry_name, registry_number, reason_for_manual_entry,
      sector, geographic_reach, latest_income, accounts_year_end, staff_count, volunteer_count,
      review_status
    ) values (
      v_actor, nullif(trim(p_legal_name), ''), nullif(trim(p_mission_statement), ''),
      p_organisation_type, nullif(trim(p_address_line_1), ''), nullif(trim(p_city), ''),
      nullif(trim(p_postcode), ''), nullif(upper(trim(p_country_code)), ''),
      nullif(trim(p_website), ''), v_email,
      v_confirmed_for, v_confirmed_by, v_confirmed_at,
      nullif(trim(p_registry_name), ''), nullif(trim(p_registry_number), ''),
      nullif(trim(p_reason), ''),
      nullif(trim(p_sector), ''), p_geographic_reach, p_latest_income, p_accounts_year_end,
      p_staff_count, p_volunteer_count,
      v_status
    ) returning id into v_id;
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_submit is true then 'manual_entry_submitted' else 'manual_entry_draft_saved' end,
    'manual_entry_records',
    v_id,
    jsonb_build_object(
      'from', case when p_entry_id is null then null else 'draft' end,
      'to', v_status
    )
  );

  if v_newly_confirmed then
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      v_actor,
      'manual_entry_contact_email_role_confirmed',
      'manual_entry_records',
      v_id,
      -- The domain only: the address may be personal, and the audit log must not
      -- become a second place it is stored.
      jsonb_build_object('email_domain', lower(substring(v_email from '@([^@]*)$')))
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_manual_entry(
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean,text,public.geographic_reach,numeric,date,integer,integer,boolean
) from public, anon;
grant execute on function public.save_manual_entry(
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean,text,public.geographic_reach,numeric,date,integer,integer,boolean
) to authenticated;
