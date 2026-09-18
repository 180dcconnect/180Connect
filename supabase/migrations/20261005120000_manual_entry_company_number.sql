-- A charity that is also a company carries two registration numbers, and the
-- register publishes both. The import path files both (write-organisations.ts
-- writes uk_charity + uk_company for a dual-registered charity), but a
-- *hand-entered* charity was filed with one number and nothing else — so the
-- record could not answer "is this also a company", the grant lookup could only
-- ask 360Giving about the charity number, and a Companies House number the
-- register already knew about was simply absent.
--
-- 20261005100000 taught the approval which register a number came from. This one
-- gives it the second number: read from the register file by the server action
-- (src/lib/charity-register/company-identifier.ts, the same read the add-a-client
-- form's check uses), stored on the entry, and filed as a second identifier at
-- approval — which may happen days later, from the review queue, in a request
-- that has no form to read.
--
-- Reversibility: paired rollback in
--   ../rollback/20261005120000_manual_entry_company_number.down.sql. It restores
--   both save_manual_entry (the 21-argument signature) and approve_manual_entry,
--   and drops the column; identifiers already filed as uk_company stay on their
--   clients, which that file's header explains.

-- ---------------------------------------------------------------------------
-- 1. The second number, on the entry
-- ---------------------------------------------------------------------------

-- The CHECK is the shape rule the rest of the app already uses for a company
-- number — src/lib/registration-number.ts upper-cases it and zero-pads it to
-- eight digits, which is exactly this pattern. A malformed value therefore
-- cannot be stored at all, rather than being caught (or silently ignored) at
-- approval, and no reader has to defend against one.
alter table public.manual_entry_records
  add column company_number text
    check (company_number is null or company_number ~ '^([0-9]{8}|[A-Z]{2}[0-9]{6})$');

comment on column public.manual_entry_records.company_number is
  'The Companies House number the charity register publishes for this charity, '
  'when registry_number is an England and Wales charity number and the register '
  'says the charity is also a company. Written by save_manual_entry from a '
  'server-side register read; never typed. Filed as a uk_company identifier on '
  'approval (20261005120000), alongside the uk_charity one.';

-- ---------------------------------------------------------------------------
-- 2. save_manual_entry: keeps the second number with the entry
-- ---------------------------------------------------------------------------

-- New signature, not a replace, for the reason 20261003130000 states: an extra
-- parameter is a different function to Postgres, and leaving the previous one
-- beside it would make the action's call ambiguous — with the worse failure mode
-- that a call omitting this parameter would quietly go to the old function and
-- never write it.
drop function public.save_manual_entry(
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean,text,public.geographic_reach,numeric,date,integer,integer,boolean
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
  p_contact_email_role_confirmed boolean default false,
  p_company_number text default null
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
      company_number = nullif(upper(trim(p_company_number)), ''),
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
      registry_name, registry_number, company_number, reason_for_manual_entry,
      sector, geographic_reach, latest_income, accounts_year_end, staff_count, volunteer_count,
      review_status
    ) values (
      v_actor, nullif(trim(p_legal_name), ''), nullif(trim(p_mission_statement), ''),
      p_organisation_type, nullif(trim(p_address_line_1), ''), nullif(trim(p_city), ''),
      nullif(trim(p_postcode), ''), nullif(upper(trim(p_country_code)), ''),
      nullif(trim(p_website), ''), v_email,
      v_confirmed_for, v_confirmed_by, v_confirmed_at,
      nullif(trim(p_registry_name), ''), nullif(trim(p_registry_number), ''),
      nullif(upper(trim(p_company_number)), ''),
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
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean,text,public.geographic_reach,numeric,date,integer,integer,boolean,text
) from public, anon;
grant execute on function public.save_manual_entry(
  uuid,text,text,public.organisation_type,text,text,text,text,text,text,text,text,text,boolean,text,public.geographic_reach,numeric,date,integer,integer,boolean,text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. approve_manual_entry: files both numbers
-- ---------------------------------------------------------------------------

-- Same signature as 20261005100000 (the second number travels on the entry, not
-- through the call), so this is a true replacement of that one function.
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

      -- 20261005120000: the second number, for a charity the register says is
      -- also a company. Written only when it is genuinely a different number on a
      -- different register: never when this entry was a Companies House one (that
      -- number is already uk_company above), and never when it repeats the number
      -- just filed. `is_primary` stays on the number the submitter identified the
      -- organisation by — the second one is corroboration, not identity, which is
      -- also why it is not given to the dedup matcher as the primary key.
      if v_entry.company_number is not null
         and app.identifier_type_for_registry(v_entry.registry_name) = 'uk_charity'
         and v_entry.company_number <> trim(v_entry.registry_number) then
        insert into public.organisation_identifiers (
          organisation_id, identifier_type, identifier_value, registry_name,
          registry_country, is_primary, verified
        ) values (
          v_organisation_id, 'uk_company', v_entry.company_number,
          'Companies House', v_entry.country_code, false, false
        );
      end if;
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
  '''manual''. 20261005120000: also files the second number when the register '
  'says a charity is also a company. link_existing still writes neither.';

revoke execute on function public.approve_manual_entry(uuid,text,boolean,uuid,text)
  from public, anon;
grant execute on function public.approve_manual_entry(uuid,text,boolean,uuid,text)
  to authenticated;
