-- Rollback of 20261003130000_contact_email_shared_inbox_override.sql.
-- Restores the F247 detector and trigger as 20260818100400 / 20260818100500 left
-- them and save_manual_entry as 20261002095000 left it, then drops the three
-- confirmation columns. Any recorded confirmations are lost with the columns;
-- entries that relied on one keep their contact_email (the trigger only fires on
-- write) but can no longer be re-saved with it.

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

create or replace function public.check_manual_entry_contact_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.contact_email is not null and app.is_personal_email(NEW.contact_email) then
    raise exception 'personal email addresses are not permitted: contact_email must be a role address'
      using errcode = '22023';
  end if;
  return NEW;
end;
$$;

create or replace function app.is_personal_email(p_address text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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

alter table public.manual_entry_records
  drop constraint if exists manual_entry_role_confirmation_complete,
  drop column if exists contact_email_role_confirmed_at,
  drop column if exists contact_email_role_confirmed_by,
  drop column if exists contact_email_role_confirmed_for;
