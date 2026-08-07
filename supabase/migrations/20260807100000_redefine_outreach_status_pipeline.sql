-- Migration: redefine_outreach_status_pipeline
-- Sequence: addition (after create_claim_organisation_rpc; needs public.organisations,
--   public.audit_log, app.is_admin, app.is_active_user). Not a numbered step — RPC
--   migrations are not rows in Data Model tab 11, following create_claim_organisation_rpc.
-- Story: F145 (#140) — Pipeline Status Field.
-- Spec: docs/rls-permission-matrix.md §2, §3.2; docs/audit-log-pattern.md
--
-- WHAT THIS CHANGES:
--   create_organisations (F233) built ORGANISATIONS.outreach_status from Data Model
--   tab 04 as it stood then: five generic values (not_started/queued/contacted/
--   replied/closed). F145's "Blocked By: Final status list" is now resolved — the
--   backlog defines ten specific pipeline statuses, one ticket each (F146-F155), and
--   their acceptance criteria name exact values (F150 "Converted", F153 "Hard No",
--   etc). This migration replaces the five-value enum with those ten, default
--   'not_contacted' (F145 AC3 / F146).
--
--   Postgres cannot drop an enum value once committed, so a straight ALTER TYPE ...
--   ADD VALUE would have left the old five permanently reachable alongside the new
--   ten. Both `organisations` tables (staging and production) are empty — confirmed
--   via `select count(*) from organisations` on both projects, 7 Aug 2026 — so there
--   is no data to migrate and no reason to carry the old values forward. The type is
--   dropped and recreated instead.
--
-- WHY THE COLUMN ALSO GETS A DIRECT-WRITE LOCKDOWN:
--   docs/audit-log-pattern.md requires that any write changing status goes through a
--   SECURITY DEFINER RPC so the update and its audit_log row commit in one
--   transaction — the same reasoning create_claim_organisation_rpc applied to
--   owner_id (see that migration's header). organisations.outreach_status was
--   previously reachable through the general organisations_update_owner_or_admin
--   UPDATE policy with no audit trail; no application code currently writes it that
--   way (grepped, 7 Aug 2026), so closing it now costs nothing. Unlike the owner_id
--   case this doesn't need a policy rewrite — a column-level REVOKE is enough, the
--   same mechanism create_users uses to keep `role` off the general grant (see that
--   migration's comment for why column privileges, not RLS, are the right tool for
--   "some columns, not others"). Every other organisations column keeps its existing
--   table-level grant; the known canonical-field-editing gap (tracked to F224, see
--   20260722103100's comment) is untouched by this migration.
--
-- WHAT set_outreach_status DOES NOT COVER:
--   docs/rls-permission-matrix.md §2 already names a *different*, not-yet-built RPC,
--   override_outreach_status(org_id, status, reason), for F224 — a reason-required
--   admin override. This migration's RPC is the ordinary path: a CAM setting the
--   status of a client they own, or an admin setting any client's, no reason
--   required. The two are expected to coexist once F224 lands; this one does not
--   pre-empt that name or behaviour.
--
-- Schema change approval record (SOP §7):
--   Change        | Drop and recreate public.outreach_status with the F146-F155
--               | value set; default changes from 'not_started' to 'not_contacted'.
--               | Revoke direct UPDATE on organisations.outreach_status from
--               | authenticated. Add set_outreach_status(org_id, status) SECURITY
--               | DEFINER RPC.
--   Reason        | F145 AC1 (exactly one status from the defined F146-F155 set at
--               | all times), AC3 (new client defaults to Not Contacted). F145's
--               | testing notes ("valid/invalid transition", "permission
--               | restriction") need an actual write path to exercise — the RPC.
--   Compatibility | organisations.outreach_status is empty on both staging and
--               | production (verified 7 Aug 2026) — no backfill needed. A CAM's or
--               | admin's direct PATCH of outreach_status through PostgREST,
--               | previously accepted, now fails a column-privilege check; grepped,
--               | the app never used that path.
--   Security      | RPC is SECURITY DEFINER, search_path pinned, re-checks caller
--               | owns the row or is admin. EXECUTE revoked from public/anon,
--               | granted to authenticated. Skips the audit insert on a same-status
--               | no-op, per docs/audit-log-pattern.md §5.
--   Documentation | Data Model tab 04/02 updated by Bashir ahead of this migration.
--               | docs/rls-permission-matrix.md §2/§3.2 updated in the same PR.
--               | Approved by Bashir (Project Leader), 7 Aug 2026.
--
-- Reversibility: paired rollback in
--   ../rollback/20260807100000_redefine_outreach_status_pipeline.down.sql

-- ---------------------------------------------------------------------------
-- Recreate the enum
-- ---------------------------------------------------------------------------
alter table public.organisations alter column outreach_status drop default;
alter table public.organisations alter column outreach_status type text using outreach_status::text;
drop type public.outreach_status;

create type public.outreach_status as enum (
  'not_contacted',         -- F146: no outreach email ever sent
  'initial_outreach_sent', -- F147: first outreach email sent
  'follow_up_sent',        -- F148: a stage-2+ follow-up sent
  'responded',             -- F149: a reply has been detected and linked
  'converted',             -- F150: agreed to work with 180DC (manual, final)
  'future_potential',      -- F151: not a fit now, worth revisiting (manual)
  'soft_no',               -- F152: declined but door left open (manual)
  'hard_no',               -- F153: firmly declined, feeds suppression (manual)
  'no_response',           -- F154: outreach sent, no reply within the window
  'loss_due_timing'        -- F155: good fit, bad timing (manual)
);

alter table public.organisations
  alter column outreach_status type public.outreach_status
  using outreach_status::public.outreach_status;
alter table public.organisations alter column outreach_status set default 'not_contacted';

comment on type public.outreach_status is
  'F145/F146-F155 — the CRM pipeline status. Exactly one of these ten values at all '
  'times; a new client defaults to not_contacted. Set only through '
  'public.set_outreach_status (ordinary path) or the future F224 '
  'override_outreach_status (reason-required admin override) — direct UPDATE on this '
  'column is revoked from authenticated (see below).';

-- ---------------------------------------------------------------------------
-- Close the direct-write path — audit-log-pattern.md requires a SECURITY DEFINER
-- RPC for any status-changing write, same reasoning as claim_organisation for
-- owner_id.
--
-- A column-level REVOKE alone does not do this: Postgres column privileges are
-- additive on top of table-level ones, not a narrowing of them — a table-level
-- `grant update` already covers every column, and `revoke update (col)` cannot
-- take a column back out of a still-standing table-level grant (verified against
-- the local pgTAP suite, 7 Aug 2026: has_column_privilege stayed true after a
-- column-only revoke). The table-level UPDATE grant has to go, replaced by an
-- explicit column list — every existing column except outreach_status — so the
-- rest of the row keeps working exactly as before and only the status column
-- moves behind the RPC. Same mechanism create_users uses to keep `role` off the
-- general grant, just approached from the "revoke-then-regrant" side because the
-- starting point here was a table-level grant rather than a fresh table.
-- ---------------------------------------------------------------------------
revoke update on public.organisations from authenticated;
grant update (
  id, legal_name, trading_name, country_code, is_international, entry_method,
  is_verified, organisation_type, website, contact_email, address_line_1, city,
  postcode, geographic_reach, data_completeness_score, owner_id, is_seed,
  created_at, updated_at
) on public.organisations to authenticated;

-- ---------------------------------------------------------------------------
-- set_outreach_status — ordinary manual status change, with an audit row
-- ---------------------------------------------------------------------------
create or replace function public.set_outreach_status(
  p_organisation_id uuid,
  p_new_status public.outreach_status
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_org    record;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  select o.id, o.owner_id, o.outreach_status into v_org
    from public.organisations o
   where o.id = p_organisation_id
     for update;

  if v_org.id is null then
    raise exception 'that client could not be found'
      using errcode = 'P0002';
  end if;

  -- Permission restriction (F145 testing notes): the CAM who owns this client, or
  -- an admin. A CAM who does not yet own the client claims it first
  -- (claim_organisation) rather than setting its status.
  if not (app.is_admin() or v_org.owner_id = v_actor) then
    raise exception 'only the client''s owner or an admin may change its status'
      using errcode = '42501';
  end if;

  -- No-op changes are not audited — the trail records real transitions only,
  -- same convention as set_user_role / claim_organisation.
  if v_org.outreach_status = p_new_status then
    return v_org.id;
  end if;

  update public.organisations
     set outreach_status = p_new_status
   where id = v_org.id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'status_changed', 'organisations', v_org.id,
    jsonb_build_object('from', v_org.outreach_status, 'to', p_new_status)
  );

  return v_org.id;
end;
$$;

comment on function public.set_outreach_status(uuid, public.outreach_status) is
  'F145: the client''s owner (CAM) or an admin sets its pipeline status to any of the '
  'ten F146-F155 values. SECURITY DEFINER so the write and its audit_log row commit '
  'in one transaction; direct UPDATE on organisations.outreach_status is revoked from '
  'authenticated, so this is the only ordinary write path. No-op (same status) is not '
  'an error and is not audited. A reason-required admin override is a separate, '
  'future RPC (override_outreach_status, F224) — this one is unconditional within '
  'permission.';

revoke execute on function public.set_outreach_status(uuid, public.outreach_status) from public;
revoke execute on function public.set_outreach_status(uuid, public.outreach_status) from anon;
grant execute on function public.set_outreach_status(uuid, public.outreach_status) to authenticated;
