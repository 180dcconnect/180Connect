-- Migration: generalize_organisation_status_flags
-- Story: F049 — Weekly Data Refresh Job (Charity Commission half; the Companies
--   House half already exists as ORGANISATION_STATUS_FLAGS, see
--   20260809100200_create_organisation_status_flags.sql).
-- Purpose: ORGANISATION_STATUS_FLAGS was built Companies-House-only. F049 needs the
--   same "detect a status drift on an already-promoted record, flag for admin
--   review, never touch outreach_status" behaviour for Charity Commission too. This
--   migration makes the existing table source-agnostic instead of standing up a
--   second, near-identical table — same shape, same RLS, same admin review queue
--   (/admin/review already renders this table; see review-panel.tsx).
--
-- WHY company_number IS NOT RENAMED: MIGRATIONS.md is explicit — "Do not rename or
--   drop a shared field without agreement on the Wednesday call." That agreement
--   hasn't happened, so this migration only ADDS a column (source) rather than
--   renaming company_number to something source-neutral like source_record_id.
--   company_number keeps its name but is now documented as dual-purpose: a
--   Companies House company number when source = 'companies_house', a Charity
--   Commission registration number when source = 'charity_commission'. Revisit the
--   rename separately if the team agrees it's worth the churn.
--
-- record_organisation_status_flag's new p_source parameter means a different
-- signature (5 argument types, not 4) — CREATE OR REPLACE FUNCTION cannot turn that
-- into a true replace; Postgres would treat it as a second, overloaded function and
-- leave the old 4-argument one in place unless it is explicitly dropped first. The
-- old signature is dropped below, and the one existing call site
-- (companies-house-status-recheck.ts) is updated in this same PR to pass p_source
-- explicitly.
--
-- Schema change approval record (SOP §7):
--   Change        | Add ORGANISATION_STATUS_FLAGS.source (text, not null, default
--                 | 'companies_house', checked against a small allowlist). Extend
--                 | record_organisation_status_flag with a trailing p_source
--                 | parameter (defaulted, so the existing call site is unaffected).
--   Reason        | Charity Commission status-recheck (F049) needs the same review-
--                 | flag mechanism Companies House already has, without duplicating
--                 | the table.
--   Compatibility | Additive only — no rename, no drop, existing rows backfilled via
--                 | the column default. The one open-flag-per-organisation unique
--                 | index (organisation_id where not resolved) is unchanged: an
--                 | organisation has one canonical source, so scoping the
--                 | uniqueness by source as well is not needed.
--   Data migration| Existing rows (Companies House only, to date) get
--                 | source = 'companies_house' via the column default.
--   Security      | No RLS change — same admin-only SELECT, no direct INSERT/UPDATE/
--                 | DELETE policy, writes only through the two existing RPCs
--                 | (service_role for record_*, admin-checked authenticated for
--                 | acknowledge_*).
--   Documentation | docs/rls-permission-matrix.md §3.5 updated in this PR to
--                 | describe the new column. docs/data-model/03-raw-data.md is
--                 | generated from the Data Model spreadsheet (SOP §7) — this PR
--                 | does not hand-edit it; the spreadsheet's ORGANISATION_STATUS_FLAGS
--                 | tab still needs a matching source column added by whoever holds
--                 | edit access, then `npm run export:data-model` re-run.
--                 | Reviewed by Bashir (Project Leader) as part of the F049 PR.
--
-- Reversibility: paired rollback in
-- ../rollback/20260811090000_generalize_organisation_status_flags.down.sql

alter table public.organisation_status_flags
  add column source text not null default 'companies_house';

alter table public.organisation_status_flags
  add constraint organisation_status_flags_source_check
  check (source in ('companies_house', 'charity_commission'));

comment on column public.organisation_status_flags.source is
  'Which weekly status-recheck job detected this drift: companies_house or '
  'charity_commission. Added by the F049 Charity Commission follow-on.';

comment on column public.organisation_status_flags.company_number is
  'The source''s own record identifier — a Companies House company number when '
  'source = ''companies_house'', a Charity Commission registration number when '
  'source = ''charity_commission''. Not renamed to a source-neutral name per '
  'MIGRATIONS.md (no shared-field rename without Wednesday-call agreement).';

drop function if exists public.record_organisation_status_flag(uuid, text, text, text);

create or replace function public.record_organisation_status_flag(
  p_organisation_id uuid,
  p_company_number  text,
  p_previous_status text,
  p_new_status      text,
  p_source          text default 'companies_house'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.organisation_status_flags%rowtype;
  v_is_noop  boolean;
begin
  if not exists (select 1 from public.organisations where id = p_organisation_id) then
    raise exception 'organisation not found' using errcode = 'P0002';
  end if;

  if p_source not in ('companies_house', 'charity_commission') then
    raise exception 'unknown status flag source: %', p_source using errcode = '22023';
  end if;

  select * into v_existing
    from public.organisation_status_flags
   where organisation_id = p_organisation_id
     and not resolved;

  v_is_noop := v_existing.id is not null
    and v_existing.previous_status = p_previous_status
    and v_existing.new_status = p_new_status
    and v_existing.source = p_source;

  -- Same transition already open and unacknowledged: nothing new for an admin to
  -- see, so neither the row nor the audit trail is touched — same no-op
  -- convention data_quality_events' record_client_criteria_outcome uses.
  if v_is_noop then
    return;
  end if;

  insert into public.organisation_status_flags (
    organisation_id, company_number, previous_status, new_status, source
  ) values (
    p_organisation_id, p_company_number, p_previous_status, p_new_status, p_source
  )
  on conflict (organisation_id) where not resolved do update set
    company_number = excluded.company_number,
    new_status = excluded.new_status,
    source = excluded.source,
    detected_at = now();

  -- Service-role action (a status-recheck job), no end user acting — actor_user_id
  -- null, same convention record_client_criteria_outcome documents.
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null, 'organisation_status_flagged', 'organisations', p_organisation_id,
    jsonb_build_object(
      'source', p_source,
      'company_number', p_company_number,
      'from', p_previous_status,
      'to', p_new_status
    )
  );
end;
$$;

comment on function public.record_organisation_status_flag(uuid, text, text, text, text) is
  'Weekly status-recheck job (Companies House or Charity Commission): records a '
  'review flag when a tracked record''s status drifts from its "alive" value. Never '
  'writes organisations.outreach_status. service_role only — called from a status- '
  'recheck job''s admin client, never from client code.';

revoke execute on function public.record_organisation_status_flag(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_organisation_status_flag(uuid, text, text, text, text)
  to service_role;
