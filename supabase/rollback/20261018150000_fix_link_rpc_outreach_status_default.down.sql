-- Rollback for 20261018150000_fix_link_rpc_outreach_status_default.sql.
-- Restores the 'not_started' fallback literal from 20260923111000.
-- WARNING: that literal is not a member of public.outreach_status, so this
-- rollback re-breaks every promotion through link_raw_record_to_organisation
-- (Charity Commission and Companies House alike). Emergency compatibility
-- rollback only — never apply forward.

create or replace function public.link_raw_record_to_organisation(
  p_organisation jsonb,
  p_raw_source_record_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organisation_id public.organisations.id%type;
begin
  if not exists (
    select 1 from public.raw_source_records where id = p_raw_source_record_id
  ) then
    raise exception 'raw source record not found' using errcode = 'P0002';
  end if;

  insert into public.organisations (
    legal_name, trading_name, country_code, is_international, entry_method,
    is_verified, organisation_type, website, contact_email, address_line_1,
    city, postcode, geographic_reach, outreach_status, data_completeness_score,
    owner_id, is_seed
  ) values (
    p_organisation->>'legal_name',
    p_organisation->>'trading_name',
    coalesce(p_organisation->>'country_code', 'GB'),
    (p_organisation->>'is_international')::boolean,
    (p_organisation->>'entry_method')::public.entry_method,
    coalesce((p_organisation->>'is_verified')::boolean, false),
    (p_organisation->>'organisation_type')::public.organisation_type,
    p_organisation->>'website',
    p_organisation->>'contact_email',
    p_organisation->>'address_line_1',
    p_organisation->>'city',
    p_organisation->>'postcode',
    (p_organisation->>'geographic_reach')::public.geographic_reach,
    coalesce((p_organisation->>'outreach_status')::public.outreach_status, 'not_started'),
    (p_organisation->>'data_completeness_score')::numeric,
    (p_organisation->>'owner_id')::uuid,
    coalesce((p_organisation->>'is_seed')::boolean, false)
  )
  returning id into v_organisation_id;

  update public.raw_source_records
     set processing_status = 'validated',
         matched_organisation_id = v_organisation_id
   where id = p_raw_source_record_id
     and processing_status = 'pending';

  if not found then
    raise exception 'raw source record is no longer pending' using errcode = 'P0002';
  end if;

  return v_organisation_id;
end;
$$;

comment on function public.link_raw_record_to_organisation(jsonb, uuid) is
  'F041 promotion, made atomic: inserts the standardised organisation and marks '
  'its pending raw_source_record validated with the link, committing both or '
  'neither. Raises if the record is missing or no longer pending (concurrent '
  'promote won). Returns the new organisation id. EXECUTE to service_role only.';

revoke execute on function public.link_raw_record_to_organisation(jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.link_raw_record_to_organisation(jsonb, uuid)
  to service_role;
