-- Migration: create_link_raw_record_to_organisation_rpc
-- Story: F041/F042 — promotion write-path hardening.
-- Purpose: make "insert the organisation" and "link the raw record to it" one
--   transaction. Until now the promote loop in
--   src/lib/standardize/write-organisations.ts did this as two separate Supabase
--   calls (insertOrganisation, then markRecordStatus 'validated'), so a crash or
--   network failure between them left an organisation with no linked
--   raw_source_records row — a client with no answer to "where did this come
--   from?", invisible until the provenance audit (20260913170000) flags it.
--   With this RPC the two writes commit or roll back together, and the
--   provenance invariant holds by construction rather than by luck.
--
-- WHY THE INSERT LIVES IN HERE: a PostgREST call is exactly one transaction.
-- Keeping the insert in application code and only moving the link into SQL
-- would still leave two commits — the same gap, one step narrower. So the
-- caller passes the standardised organisation as JSON; this function inserts
-- it, then flips the raw record to 'validated' with the link, atomically.
-- The JSON keys are the StandardOrganisation fields written by the promote
-- mappers (src/lib/standardize/types.ts) — a closed TypeScript type, so the
-- column list below tracks it one-to-one. A key arriving as JSON null inserts
-- SQL NULL, matching what supabase-js `.insert(org)` did before; enum values
-- are cast explicitly so a bad value fails loudly instead of writing junk.
--
-- Double-promotion guard: the status update only matches a record still
-- 'pending'. If a concurrent run already settled the record, the update matches
-- no row, this function raises, and the transaction rolls back — so the
-- organisation insert inside it never commits either. Promotion keeps its own
-- insert-dedup (findDuplicateMatch + intra-batch push); this is the belt to
-- that brace.
--
-- Audit: promotion is an ingestion-side status write (pending → validated),
-- not a user action on ownership/status/role/approval state, so per
-- docs/audit-log-pattern.md §1 and the precedent of record_client_criteria_outcome
-- (20260808100000, a service_role-only promote-path RPC that writes no audit_log
-- row) this RPC writes none either.
--
-- Schema change approval record (SOP §7):
--   Change        | Add public.link_raw_record_to_organisation(jsonb, uuid),
--                 | SECURITY DEFINER, returns the new organisation id. No table
--                 | changes.
--   Reason        | Organisation insert and raw-record link must commit or roll
--                 | back together; separately they are the one way the
--                 | "every client has a source" invariant could silently break.
--   Compatibility | Additive. The promote loop adopts it for its success
--                 | transition; markRecordStatus remains for every other status.
--   Data migration| None. (Historical gaps, if any, are the provenance audit's
--                 | problem — get_unprovenanced_organisations finds them.)
--   Security      | EXECUTE revoked from public/anon/authenticated, granted to
--                 | service_role only — the promote pipeline runs as service_role,
--                 | and no user session ever creates clients from raw records.
--   Documentation | Data Model unchanged (no schema change); recorded in the
--                 | migration header and the promote loop's comments.
--
-- Reversibility: paired rollback in
-- ../rollback/20260913190000_create_link_raw_record_to_organisation_rpc.down.sql

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
    coalesce((p_organisation->>'outreach_status')::public.outreach_status, 'not_started'),
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
