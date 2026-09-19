-- Migration: fix_link_rpc_outreach_status_default
-- Purpose: repair public.link_raw_record_to_organisation, which has inserted
--   zero clients since it was created in 20260923111000.
--
-- Root cause: line 98 of that migration coalesces a missing outreach_status to
--   'not_started':
--
--     coalesce((p_organisation->>'outreach_status')::public.outreach_status, 'not_started')
--
--   'not_started' has not been a member of public.outreach_status since
--   20260807100000_redefine_outreach_status_pipeline dropped and recreated the
--   enum (default 'not_contacted'). Every source mapper standardises new
--   records as outreach_status 'not_contacted' (see
--   src/lib/standardize/types.ts and each mapper), so the fallback value is
--   never even selected — but Postgres still coerces the unknown literal to
--   the enum when planning the statement, and an invalid enum literal fails
--   the whole call. Result: every promotion attempt raises
--   'invalid input value for enum public.outreach_status: "not_started"',
--   the row is marked 'error', and no organisation is ever inserted — for the
--   Charity Commission bulk path, the single-lookup path, AND Companies House,
--   which promotes through the same function.
--
--   Observed in production: a 2,231-row register import staged 2,231 raw
--   records, added 0 clients, recorded 1,934 errors with 297 still pending; a
--   66-row follow-up errored on all 66. Import Status labelled the staging
--   counter "added", hiding the failure (fixed separately on the admin pages).
--
-- Schema change approval record (SOP §7):
--   Change        | Replace the obsolete 'not_started' fallback literal in
--                 | public.link_raw_record_to_organisation(jsonb, uuid) with
--                 | 'not_contacted'. Function body otherwise byte-identical;
--                 | no signature, grant, or table changes.
--   Reason        | The current fallback is not a member of the enum, so the
--                 | function raises on every call and all client creation
--                 | through it fails.
--   Compatibility | Additive repair. Callers already send valid statuses; only
--                 | the previously-unreachable fallback path changes value, to
--                 | the column default the enum redefinition chose.
--   Data migration| None in this file. Errored raw_source_records
--                 | (processing_status 'error') are NOT picked up by promotion,
--                 | which only reads 'pending' — after this lands, re-run the
--                 | affected imports (the import re-stages errored rows back to
--                 | pending and promotes) or reset those rows to 'pending'
--                 | manually. Do NOT re-run imports before this is applied.
--   Security      | Unchanged: EXECUTE stays revoked from public/anon/
--                 | authenticated and granted to service_role only (as set in
--                 | 20260923111000). No RLS changes (no tables touched).
--   Documentation | Data Model unchanged (no schema change); recorded here.
--
-- Reversibility: paired rollback in
-- ../rollback/20261018150000_fix_link_rpc_outreach_status_default.down.sql
-- (restores the faulty literal; emergency use only — it re-breaks promotion).

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
  -- Fail loudly on an unknown record rather than silently writing nothing: a
  -- promote run pointing at a missing raw record is a bug, and a quiet no-op
  -- would reintroduce exactly the divergence this function exists to prevent.
  if not exists (
    select 1 from public.raw_source_records where id = p_raw_source_record_id
  ) then
    raise exception 'raw source record not found' using errcode = 'P0002';
  end if;

  -- Keys mirror StandardOrganisation (src/lib/standardize/types.ts) one-to-one.
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
    coalesce((p_organisation->>'outreach_status')::public.outreach_status, 'not_contacted'),
    (p_organisation->>'data_completeness_score')::numeric,
    (p_organisation->>'owner_id')::uuid,
    coalesce((p_organisation->>'is_seed')::boolean, false)
  )
  returning id into v_organisation_id;

  -- The guard is the whole point: if the record is no longer pending (a
  -- concurrent promote won), the update matches no row, the raise below rolls
  -- the transaction back — org insert included — and no duplicate client is
  -- created.
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
