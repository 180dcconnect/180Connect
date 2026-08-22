-- Migration: restrict_organisation_sensitive_columns
-- Story: F020 Restricted Editing (#23)
-- Spec: docs/rls-permission-matrix.md §3.2 — this closes the open gap documented
--   there since F077 landed: a CAM who owns an organisation row can still UPDATE its
--   six sensitive columns directly through the §3.2 policy (or PostgREST), which is
--   exactly what F020 exists to stop.
--
-- THE MECHANISM: RLS policies are row-level — they cannot refuse one column of an
--   allowed row (matrix §2, "a policy cannot forbid one column"). The anticipated
--   answer, already named in the matrix, is a BEFORE UPDATE column guard: a trigger
--   that compares old vs new values for every active RESTRICTED_EDIT_FIELDS row and
--   refuses the write when any of them moved under a non-admin.
--
-- WHO IS AFFECTED:
--   - An owning CAM changing legal_name/website/contact_email/address_line_1/city/
--     postcode directly → 42501, told to submit a suggested edit instead (#23 AC1).
--     This holds on the API route too: the trigger sits below the app, so a hand-
--     crafted PostgREST call meets the same wall (testing notes: "direct API call").
--   - The same CAM changing trading_name, notes-adjacent descriptive columns etc.
--     → unaffected (#23 AC2: non-sensitive fields stay directly editable).
--   - Admins → unaffected; §3.2's admin write path stays intact.
--   - Background jobs (enrichment workers, crons) run without a JWT, so auth.uid()
--     is null → skipped. They were never the threat model.
--
-- WHY CONFIG-DRIVEN: the loop reads active rows from restricted_edit_fields
--   (20260822160000). When an admin restricts or retires a field, enforcement moves
--   with it — no migration, no redeploy, no drift between what the UI claims and
--   what the database refuses.
--
-- NO AUDIT ROW ON REFUSAL: nothing changed. The blocked attempt is visible in
--   PostgREST/API logs; ERROR_LOG captures unexpected failures at the action layer.
--   Audit-log-pattern scope is state changes, not refused ones.
--
-- PERFORMANCE: one indexed scan of an expected-tiny config table per UPDATE on
--   organisations. Client edits are single-row, human-rate operations; this is noise
--   next to the existing updated_at trigger.
--
-- Schema change approval record (SOP §7):
--   Change        | New function enforce_restricted_org_columns + BEFORE UPDATE
--                 | trigger on organisations. No table, grant or policy changes.
--   Reason        | #23 AC1 — a CAM cannot save a sensitive-field change directly;
--                 | it must go through the suggestion flow (F077–F079).
--   Compatibility | The seeded six behave as if always enforced. Any existing code
--                 | path writing those columns as non-admin must use the suggestion
--                 | RPC — none does today (verified: no client-side UPDATE on
--                 | organisations touches the six outside admin surfaces).
--   Data migration| None.
--   Security      | Trigger runs as the invoking role with no elevation; raises
--                 | 42501 with a user-safe message naming only the column.
--   Documentation | RLS matrix §3.2 gap paragraph marked resolved; tab 11 step 24.4.
--
-- Reversibility: paired rollback in ../rollback/20260822160100_restrict_organisation_sensitive_columns.down.sql

create or replace function public.enforce_restricted_org_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r public.restricted_edit_fields.field_name%type;
begin
  -- Background jobs (crons, enrichment workers) run without a JWT. They are not
  -- who this guard is for; blocking them would break ingestion for nothing.
  if (select auth.uid()) is null then
    return new;
  end if;

  -- Admins keep the §3.2 write path in full — restriction is about CAMs.
  if app.is_admin() then
    return new;
  end if;

  for r in
    select field_name from public.restricted_edit_fields where active
  loop
    if (to_jsonb(new) ->> r) is distinct from (to_jsonb(old) ->> r) then
      raise exception 'the % field is admin-managed — submit a suggested edit instead', r
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.enforce_restricted_org_columns() is
  '#23 (F020): BEFORE UPDATE guard on organisations. Refuses (42501) any non-admin '
  'write that changes a column listed active in restricted_edit_fields — corrections '
  'go through suggest_organisation_edit instead. Skips unauthenticated sessions '
  '(background jobs); admins pass untouched.';

create trigger organisations_block_restricted_columns
  before update on public.organisations
  for each row execute function public.enforce_restricted_org_columns();
