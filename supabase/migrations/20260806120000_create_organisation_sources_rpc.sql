-- Migration: create_organisation_sources_rpc
-- Story: F043 Source Tracking.
-- Sequence: additive read function after create_ingestion (step 6.0).
--
-- Source metadata already has an approved home: API contributors are
-- RAW_SOURCE_RECORDS rows linked through matched_organisation_id, while a manual
-- origin is ORGANISATIONS.entry_method = 'manual'. This function exposes only the
-- safe provenance fields needed by a client profile. It deliberately does not expose
-- raw_payload, which the RLS matrix reserves for admins because third-party payloads
-- may contain sensitive data.
--
-- Multiple linked raw rows produce multiple contributors. Later imports and edits do
-- not replace earlier links, so provenance persists. F042 can attach a duplicate raw
-- record to an existing organisation and it will appear here without changing F043.
--
-- Schema change approval record (SOP §7):
--   Change        | Add public.get_organisation_sources(uuid), no table changes
--   Reason        | F043: safely display every contributing source on client profiles
--   Compatibility | Additive RPC over existing approved fields
--   Data migration| None
--   Security      | Active authenticated users only; returns metadata, never raw_payload
--   Documentation | Existing Data Model tabs 03/04 already define every source field
--
-- Reversibility: paired rollback in
-- ../rollback/20260806120000_create_organisation_sources_rpc.down.sql

create or replace function public.get_organisation_sources(p_organisation_id uuid)
returns table (
  source text,
  source_record_id text,
  source_registry_name text,
  first_seen_at timestamptz
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

  if not exists (
    select 1 from public.organisations where id = p_organisation_id
  ) then
    raise exception 'organisation not found' using errcode = 'P0002';
  end if;

  return query
  with contributors as (
    select
      raw.record_source::text as source,
      raw.source_record_id,
      raw.source_registry_name,
      raw.created_at as first_seen_at
    from public.raw_source_records raw
    where raw.matched_organisation_id = p_organisation_id

    union all

    select
      'manual'::text,
      null::text,
      null::text,
      organisation.created_at
    from public.organisations organisation
    where organisation.id = p_organisation_id
      and organisation.entry_method = 'manual'
  )
  select distinct on (contributors.source)
    contributors.source,
    contributors.source_record_id,
    contributors.source_registry_name,
    contributors.first_seen_at
  from contributors
  order by contributors.source, contributors.first_seen_at;
end;
$$;

comment on function public.get_organisation_sources(uuid) is
  'F043: safe source provenance for a client profile. Returns every linked API source '
  'plus Manual Entry when applicable; never exposes raw third-party payloads.';

revoke execute on function public.get_organisation_sources(uuid) from public;
revoke execute on function public.get_organisation_sources(uuid) from anon;
grant execute on function public.get_organisation_sources(uuid) to authenticated;
