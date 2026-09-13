-- Migration: manual_entry_sector_reach_size
-- Story: Add a client — the hand-entered route collects what the score and the
-- record's completeness checks read. Sequence step 28.4.
-- Source: Data Model tab 03 MANUAL_ENTRY_RECORDS (six new optional fields) and
-- tab 04 FINANCIAL_PERIODS.financial_source (new value 'manual').
-- Compatibility: additive. save_manual_entry keeps its fourteen leading
-- parameters and every new one defaults to null, so existing callers — the
-- server action, the pgTAP suite — are unchanged.
-- Security: no new table; writes stay RPC-only, RLS unchanged. Not audited
-- beyond the existing submit/approve audit rows — no ownership, status, role or
-- approval state changes here.
-- Reversibility: ../rollback/20261002090000_manual_entry_sector_reach_size.down.sql
--
-- WHY THIS MIGRATION EXISTS: a client added by hand arrived with a name, an
-- address and a mission and nothing else the app scores on. ORGANISATIONS.sector
-- stayed null (the sector score fell back to neutral), geographic_reach stayed
-- null (CAM queue preferences could not match it), and no FINANCIAL_PERIODS row
-- existed, so the size score was neutral and the record's "Filed accounts" and
-- "Headcount" completeness ticks could never fill. A register import brings all
-- of that; this is the fallback route, and it now asks for the few facts a person
-- can realistically know.
--
-- ── Why size is a financial period and not columns on ORGANISATIONS ──
--
-- Income, staff and volunteers already have a home: FINANCIAL_PERIODS, which
-- the size score, the income-band preference and the completeness strip all read.
-- A second copy on the organisation would be one more thing to keep in step. So
-- the entry holds the figures and the year end they belong to, and approval files
-- them as one period with financial_source = 'manual'.
--
-- ── Why sector is free text here ──
--
-- ORGANISATIONS.sector is free text (20260824100000) and the score matches it
-- against the F197 taxonomy. The form offers only that taxonomy; the column stays
-- text so this migration does not quietly invent the canonical enum F055 owns.

alter type public.financial_source add value if not exists 'manual';

alter table public.manual_entry_records
  add column sector text
    check (sector is null or length(trim(sector)) between 1 and 100),
  add column geographic_reach public.geographic_reach,
  add column latest_income numeric
    check (latest_income is null or latest_income >= 0),
  add column accounts_year_end date,
  add column staff_count integer
    check (staff_count is null or staff_count >= 0),
  add column volunteer_count integer
    check (volunteer_count is null or volunteer_count >= 0),
  add constraint manual_entry_size_has_year_end check (
    (latest_income is null and staff_count is null and volunteer_count is null)
    or accounts_year_end is not null
  );

-- A new signature, not a replace: Postgres treats extra parameters as a different
-- function, and leaving the fourteen-argument one beside it would make every
-- existing positional call ambiguous.
drop function public.save_manual_entry(uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean);

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
  p_volunteer_count integer default null
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
      registry_name, registry_number, reason_for_manual_entry,
      sector, geographic_reach, latest_income, accounts_year_end, staff_count, volunteer_count,
      review_status
    ) values (
      v_actor, nullif(trim(p_legal_name), ''), nullif(trim(p_mission_statement), ''),
      p_organisation_type, nullif(trim(p_address_line_1), ''), nullif(trim(p_city), ''),
      nullif(trim(p_postcode), ''), nullif(upper(trim(p_country_code)), ''),
      nullif(trim(p_website), ''), nullif(trim(p_contact_email), ''),
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
  return v_id;
end;
$$;

revoke execute on function public.save_manual_entry(
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean,text,public.geographic_reach,numeric,date,integer,integer
) from public, anon;
grant execute on function public.save_manual_entry(
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean,text,public.geographic_reach,numeric,date,integer,integer
) to authenticated;

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
      city, postcode, geographic_reach, sector, data_completeness_score, owner_id, is_seed
    ) values (
      trim(v_entry.legal_name), '', v_entry.country_code, v_entry.country_code <> 'GB',
      'manual', false, v_entry.organisation_type, v_entry.website, v_entry.contact_email,
      v_entry.address_line_1, v_entry.city, v_entry.postcode, v_entry.geographic_reach,
      v_entry.sector, v_score, null, false
    ) returning id into v_organisation_id;

    insert into public.enrichment_results (
      organisation_id, mission_statement, website_url, sector, confidence_score, needs_review
    ) values (
      v_organisation_id, v_entry.mission_statement, v_entry.website, v_entry.sector, 1, false
    );

    -- 20261002090000: size, when the submitter gave it, as one manual financial
    -- period ending on the accounts year end they named. The period is the year
    -- to that date, the band is derived exactly as src/lib/income-band.ts derives
    -- it, and the source says 'manual' so nothing reads it as a filed return.
    if v_entry.accounts_year_end is not null then
      insert into public.financial_periods (
        organisation_id, period_start, period_end, total_income, income_band,
        count_employees, count_volunteers, financial_source
      ) values (
        v_organisation_id,
        (v_entry.accounts_year_end - interval '1 year' + interval '1 day')::date,
        v_entry.accounts_year_end,
        v_entry.latest_income,
        case
          when v_entry.latest_income is null then null
          when v_entry.latest_income < 10000 then 'under_10k'
          when v_entry.latest_income <= 100000 then '10k_100k'
          when v_entry.latest_income <= 1000000 then '100k_1m'
          else 'over_1m'
        end::public.income_band,
        v_entry.staff_count,
        v_entry.volunteer_count,
        'manual'
      );
    end if;

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
  'F036/F042 manual-entry approval. 20260923114000: per-field provenance on '
  'create_new. 20261002090000: also carries sector and geographic_reach onto '
  'the organisation and files any size figures as one financial period with '
  'financial_source = ''manual''. link_existing still writes neither.';

revoke execute on function public.approve_manual_entry(uuid,text,boolean,uuid,text)
  from public, anon;
grant execute on function public.approve_manual_entry(uuid,text,boolean,uuid,text)
  to authenticated;
