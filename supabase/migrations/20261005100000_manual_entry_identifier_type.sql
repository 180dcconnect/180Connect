-- A manual entry's registration number was always filed as identifier_type
-- 'manual', whatever register the CAM had named — so a number copied out of the
-- charity register was indistinguishable from one typed off a letterhead.
--
-- That is not a cosmetic mislabel. `organisation_identifiers.identifier_type`
-- is what every register-aware feature keys on: 360Giving grant history asks
-- for `uk_charity` / `uk_company` and refuses with "no charity or company
-- number on record" when it finds neither, the 360Giving mapper matches grants
-- to clients on `uk_company`, and the client list's filters and the score's
-- register factor read the same column. A charity added from the register with
-- "Use these details" therefore arrived with its charity number held, and every
-- one of those features acting as though it were absent.
--
-- The register is already on the row: `manual_entry_records.registry_name` is
-- stored from the closed list in src/lib/registration-number.ts ("Choice, not
-- free text" — the same reason that list exists), so the type is derivable
-- rather than something a person should have to pick twice.
--
-- ── Why only two registers ──
--
-- OSCR, CCNI and "Another register" stay 'manual' deliberately. We hold a file
-- for the England and Wales register and for Companies House, and 360Giving
-- addresses those two by `GB-CHC-` / `GB-COH-` prefixed numbers. Labelling a
-- Scottish (SC...) or Northern Irish (NIC...) number `uk_charity` would make the
-- grant lookup ask 360Giving the wrong question and read the empty answer as
-- "this charity has never taken a grant" — a wrong answer is worse than an
-- honest one, so the type stays 'manual' until there is a register file behind
-- it.

-- ---------------------------------------------------------------------------
-- The rule, in one place
-- ---------------------------------------------------------------------------

-- Mirrors `registerIdForName` in src/lib/registration-number.ts, because the
-- two must never disagree about which register a stored name means: that
-- function decides what the form shows for a name, and this one decides what
-- the record stores. Tolerant of the spellings older drafts hold ("CCEW",
-- "charity commission") for the same reason — a draft saved before the closed
-- list existed must still classify.
--
-- "England and Wales" is required before the bare name is trusted. A CAM
-- naming "Charity Commission of Kenya" under "Another register" is naming a
-- different country's regulator, and filing its number as a UK charity number
-- would send it to 360Giving as a GB-CHC number that is not its own.
create or replace function app.identifier_type_for_registry(p_registry_name text)
returns public.identifier_type
language sql
immutable
set search_path = ''
as $$
  select case
    when normalised.name like '%companies house%' then 'uk_company'::public.identifier_type
    when normalised.name in ('ccew', 'charity commission')
      or (normalised.name like 'charity commission%'
          and normalised.name like '%england%'
          and normalised.name like '%wales%')
      then 'uk_charity'::public.identifier_type
    else 'manual'::public.identifier_type
  end
  from (select lower(trim(coalesce(p_registry_name, ''))) as name) as normalised;
$$;

comment on function app.identifier_type_for_registry(text) is
  'The identifier_type a registration number should be filed under, given the '
  'register it was taken from. Only the two registers this deployment can act '
  'on — the England and Wales charity register and Companies House — are '
  'recognised; anything else stays ''manual''.';

-- ---------------------------------------------------------------------------
-- Repair what was already written
-- ---------------------------------------------------------------------------

-- Only rows that name a register we hold are touched, and only where the
-- organisation does not already carry that number under the right type — the
-- same number filed twice under one organisation would defeat dedup, which
-- matches on the value. Re-runnable: a second run finds nothing left to fix.
update public.organisation_identifiers identifier
   set identifier_type = app.identifier_type_for_registry(identifier.registry_name)
 where identifier.identifier_type = 'manual'
   and app.identifier_type_for_registry(identifier.registry_name) <> 'manual'
   and not exists (
     select 1
       from public.organisation_identifiers existing
      where existing.organisation_id = identifier.organisation_id
        and existing.id <> identifier.id
        and existing.identifier_type = app.identifier_type_for_registry(identifier.registry_name)
        and trim(existing.identifier_value) = trim(identifier.identifier_value)
   );

-- ---------------------------------------------------------------------------
-- The approval, now classifying the number it files
-- ---------------------------------------------------------------------------

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

    -- 20261002095000: size, when the submitter gave it, as one manual financial
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
        v_organisation_id,
        -- 20261005100000: the register the number came from decides the type, so
        -- a number taken from the charity register is a uk_charity number and
        -- every register-aware feature can find it. Still `verified = false`:
        -- nothing has checked it against the register — a CAM copied it, or a
        -- register *file* was read for it, and both are "held", not "checked".
        app.identifier_type_for_registry(v_entry.registry_name),
        trim(v_entry.registry_number),
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
  'create_new. 20261002095000: also carries sector and geographic_reach onto '
  'the organisation and files any size figures as one financial period with '
  'financial_source = ''manual''. 20261005100000: files the registration number '
  'under the register it names (uk_charity / uk_company) rather than always '
  '''manual''. link_existing still writes neither.';

revoke execute on function public.approve_manual_entry(uuid,text,boolean,uuid,text)
  from public, anon;
grant execute on function public.approve_manual_entry(uuid,text,boolean,uuid,text)
  to authenticated;
