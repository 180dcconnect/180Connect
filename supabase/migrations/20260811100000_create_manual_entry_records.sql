-- Migration: create_manual_entry_records
-- Story: F036 Manual Client Entry. Sequence step 7.0 (create_quality).
-- Source: Data Model tab 03 MANUAL_ENTRY_RECORDS.
-- Compatibility: additive table and RPCs; no existing rows are changed.
-- Security: RPC-only writes, submitter/admin reads, audited status transitions.
-- Reversibility: ../rollback/20260811100000_create_manual_entry_records.down.sql

create type public.manual_review_status as enum ('draft', 'pending', 'approved', 'rejected');

create table public.manual_entry_records (
  id uuid primary key default gen_random_uuid(),
  submitted_by_user_id uuid not null references public.users (id),
  legal_name text check (legal_name is null or length(trim(legal_name)) between 1 and 200),
  mission_statement text check (mission_statement is null or length(trim(mission_statement)) between 1 and 5000),
  organisation_type public.organisation_type,
  address_line_1 text check (address_line_1 is null or length(trim(address_line_1)) between 1 and 300),
  city text check (city is null or length(trim(city)) between 1 and 200),
  postcode text check (postcode is null or length(trim(postcode)) between 1 and 32),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  website text check (website is null or length(trim(website)) between 1 and 500),
  contact_email text check (contact_email is null or length(trim(contact_email)) between 1 and 320),
  registry_name text check (registry_name is null or length(trim(registry_name)) between 1 and 200),
  registry_number text check (registry_number is null or length(trim(registry_number)) between 1 and 200),
  reason_for_manual_entry text check (
    reason_for_manual_entry is null or length(trim(reason_for_manual_entry)) between 10 and 2000
  ),
  converted_to_organisation_id uuid references public.organisations (id),
  review_status public.manual_review_status not null default 'draft',
  reviewed_by_user_id uuid references public.users (id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_entry_review_consistent check (
    (review_status in ('draft', 'pending') and reviewed_by_user_id is null and reviewed_at is null)
    or (review_status in ('approved', 'rejected') and reviewed_by_user_id is not null and reviewed_at is not null)
  ),
  constraint manual_entry_conversion_consistent check (
    converted_to_organisation_id is null or review_status = 'approved'
  ),
  constraint manual_entry_submission_complete check (
    review_status = 'draft'
    or (
      nullif(trim(legal_name), '') is not null
      and nullif(trim(mission_statement), '') is not null
      and organisation_type is not null
      and nullif(trim(address_line_1), '') is not null
      and nullif(trim(city), '') is not null
      and nullif(trim(postcode), '') is not null
      and nullif(trim(country_code), '') is not null
      and nullif(trim(website), '') is not null
      and nullif(trim(contact_email), '') is not null
      and nullif(trim(registry_name), '') is not null
      and nullif(trim(registry_number), '') is not null
      and nullif(trim(reason_for_manual_entry), '') is not null
    )
  )
);

create trigger manual_entry_records_set_updated_at
  before update on public.manual_entry_records
  for each row execute function public.set_updated_at();

create index manual_entry_records_review_status_idx
  on public.manual_entry_records (review_status, created_at desc);
create index manual_entry_records_submitter_idx
  on public.manual_entry_records (submitted_by_user_id, created_at desc);

revoke all on public.manual_entry_records from anon, authenticated;
grant select on public.manual_entry_records to authenticated;
alter table public.manual_entry_records enable row level security;

create policy manual_entry_records_select_own_or_admin on public.manual_entry_records
  for select to authenticated
  using (app.is_active_user() and (submitted_by_user_id = (select auth.uid()) or app.is_admin()));

create or replace function public.save_manual_entry(
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
  p_submit boolean
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

    update public.manual_entry_records set
      legal_name = nullif(trim(p_legal_name), ''),
      mission_statement = nullif(trim(p_mission_statement), ''),
      organisation_type = p_organisation_type,
      address_line_1 = nullif(trim(p_address_line_1), ''),
      city = nullif(trim(p_city), ''),
      postcode = nullif(trim(p_postcode), ''),
      country_code = nullif(upper(trim(p_country_code)), ''),
      website = nullif(trim(p_website), ''),
      contact_email = nullif(trim(p_contact_email), ''),
      registry_name = nullif(trim(p_registry_name), ''),
      registry_number = nullif(trim(p_registry_number), ''),
      reason_for_manual_entry = nullif(trim(p_reason), ''),
      review_status = v_status
    where id = p_entry_id
    returning id into v_id;
  else
    insert into public.manual_entry_records (
      submitted_by_user_id, legal_name, mission_statement, organisation_type,
      address_line_1, city, postcode, country_code, website, contact_email,
      registry_name, registry_number, reason_for_manual_entry, review_status
    ) values (
      v_actor, nullif(trim(p_legal_name), ''), nullif(trim(p_mission_statement), ''),
      p_organisation_type, nullif(trim(p_address_line_1), ''), nullif(trim(p_city), ''),
      nullif(trim(p_postcode), ''), nullif(upper(trim(p_country_code)), ''),
      nullif(trim(p_website), ''), nullif(trim(p_contact_email), ''),
      nullif(trim(p_registry_name), ''), nullif(trim(p_registry_number), ''),
      nullif(trim(p_reason), ''), v_status
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
  return v_id;
end;
$$;

create or replace function public.reject_manual_entry(p_entry_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.manual_review_status;
begin
  if not app.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  select review_status into v_old from public.manual_entry_records where id = p_entry_id for update;
  if v_old is null then raise exception 'manual entry not found' using errcode = 'P0002'; end if;
  if v_old <> 'pending' then raise exception 'manual entry has already been reviewed' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_notes, ''))) < 3 then raise exception 'review notes are required' using errcode = '22023'; end if;

  update public.manual_entry_records set
    review_status = 'rejected', reviewed_by_user_id = v_actor,
    reviewed_at = now(), review_notes = trim(p_notes)
  where id = p_entry_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (v_actor, 'manual_entry_rejected', 'manual_entry_records', p_entry_id,
    jsonb_build_object('from', v_old, 'to', 'rejected', 'notes', trim(p_notes)));
end;
$$;

revoke execute on function public.save_manual_entry(
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean
) from public, anon;
grant execute on function public.save_manual_entry(
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean
) to authenticated;
revoke execute on function public.reject_manual_entry(uuid,text) from public, anon;
grant execute on function public.reject_manual_entry(uuid,text) to authenticated;

-- F036 approval is deliberately one database transaction. F042's shared matcher
-- operates on RAW_SOURCE_RECORDS, while manual submissions live in the separate
-- MANUAL_ENTRY_RECORDS table approved by the Data Model. This RPC mirrors F042's
-- registration-number then normalised-name rules and requires the admin's explicit
-- link-existing/create-new decision before it writes an active organisation.
create or replace function public.approve_manual_entry(
  p_entry_id uuid,
  p_admin_confirmed_eligible boolean,
  p_duplicate_decision text,
  p_candidate_organisation_id uuid,
  p_notes text
) returns uuid
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

revoke execute on function public.approve_manual_entry(uuid,boolean,text,uuid,text)
  from public, anon;
grant execute on function public.approve_manual_entry(uuid,boolean,text,uuid,text)
  to authenticated;

comment on table public.enrichment_results is
  'Organisation profile enrichment from automated sources or an approved manual entry. '
  'End-user roles have no direct write grant; controlled SECURITY DEFINER workflows may append.';

-- Expanded F043 view for F036: safe source metadata plus the CAM who created a
-- manual contribution. It wraps the existing F043 RPC and adds approved manual
-- entries, including a manual contribution linked to an existing API organisation.
create or replace function public.get_organisation_sources_with_actor(p_organisation_id uuid)
returns table (
  source text,
  source_record_id text,
  source_registry_name text,
  first_seen_at timestamptz,
  source_actor_user_id uuid,
  source_actor_name text
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

  return query
  with contributors as (
    select base.source, base.source_record_id, base.source_registry_name,
           base.first_seen_at, null::uuid as source_actor_user_id,
           null::text as source_actor_name
      from public.get_organisation_sources(p_organisation_id) base

    union all

    select 'manual'::text, manual.id::text, manual.registry_name,
           manual.created_at, manual.submitted_by_user_id, creator.full_name
      from public.manual_entry_records manual
      left join public.users creator on creator.id = manual.submitted_by_user_id
     where manual.converted_to_organisation_id = p_organisation_id
       and manual.review_status = 'approved'
  )
  select distinct on (contributors.source)
    contributors.source,
    contributors.source_record_id,
    contributors.source_registry_name,
    contributors.first_seen_at,
    contributors.source_actor_user_id,
    contributors.source_actor_name
  from contributors
  order by contributors.source,
           (contributors.source_actor_user_id is null),
           contributors.first_seen_at;
end;
$$;

revoke execute on function public.get_organisation_sources_with_actor(uuid) from public, anon;
grant execute on function public.get_organisation_sources_with_actor(uuid) to authenticated;
