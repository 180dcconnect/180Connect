-- Migration: create_provenance_audit_rpc
-- Story: F221/F242 — "no provenance = ingestion gap" invariant, made enforceable.
-- Purpose: one SECURITY DEFINER function that returns every organisation with no
--   answer to "where did this record come from?" — the single query the audit
--   sweep (src/lib/ingestion/provenance-audit.ts) diffs against the last sweep's
--   audit_log row, and that admins can run ad hoc:
--
--     select * from public.get_unprovenanced_organisations();
--
-- An organisation is "unprovenanced" when it was created through the API path
-- (entry_method = 'api') but no raw_source_records row is linked to it — i.e. no
-- register contributed, so the Data Sources card shows nothing and the record
-- header's "Assembled from…" line cannot be rendered. Manual entries are not
-- flagged: their provenance is the submitting person, already carried by
-- get_organisation_sources_with_actor. Seed rows (is_seed) are excluded: fake
-- clients must not page the team.
--
-- Schema change approval record (SOP §7):
--   Change        | Add public.get_unprovenanced_organisations(), SECURITY DEFINER,
--                 | returns set of (organisation_id, legal_name, entry_method,
--                 | created_at). No table changes.
--   Reason        | The invariant "every client has at least one source" was true
--                 | by construction but unverifiable: partial promote failures
--                 | (insertOrganisation + markRecordStatus are separate calls)
--                 | could leave an org with no linked raw record, silently. This
--                 | makes the gap visible and auditable.
--   Compatibility | Additive read-only RPC. No existing query or policy changes.
--   Data migration| None.
--   Security      | EXECUTE revoked from public/anon/authenticated, granted to
--                 | service_role only (same convention as
--                 | record_client_criteria_outcome, 20260808100000): the sweep
--                 | runs as service_role, and an authenticated caller has no
--                 | need — admins see the result via the audit_log row the sweep
--                 | writes (action 'provenance_audited', readable through
--                 | audit_log_select_admin).
--   Documentation | docs/data-model/04-entities.md not changed (no table change);
--                 function documented here and in the sweep module header.
--
-- Reversibility: paired rollback in ../rollback/20260922095000_create_provenance_audit_rpc.down.sql

create or replace function public.get_unprovenanced_organisations()
returns table (
  organisation_id uuid,
  legal_name text,
  entry_method text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.legal_name, o.entry_method::text, o.created_at
    from public.organisations o
   where o.entry_method = 'api'
     and o.is_seed = false
     and not exists (
       select 1 from public.raw_source_records r
        where r.matched_organisation_id = o.id
     );
$$;

comment on function public.get_unprovenanced_organisations() is
  'F221 provenance invariant: every API-created organisation must have at least '
  'one linked raw_source_records row. Returns the violators — an empty result '
  'means every client can answer "where did this come from?". Manual entries and '
  'seed rows are excluded by design. SECURITY DEFINER; EXECUTE to service_role '
  'only.';

revoke execute on function public.get_unprovenanced_organisations()
  from public, anon, authenticated;
grant execute on function public.get_unprovenanced_organisations()
  to service_role;
