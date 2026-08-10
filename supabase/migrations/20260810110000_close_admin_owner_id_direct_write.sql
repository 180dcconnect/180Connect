-- Migration: close_admin_owner_id_direct_write
-- Sequence: addition (after create_claim_organisation_rpc, redefine_outreach_status_pipeline
--   and unify_offboarding_reassignment; needs public.organisations,
--   public.reassign_ownership). Not a numbered step — column-privilege-only
--   migrations are not rows in Data Model tab 11, following
--   redefine_outreach_status_pipeline.
-- Story: F163 (#158) — Assign Client Owner.
-- Spec: docs/rls-permission-matrix.md §3.2
--
-- WHAT THIS CLOSES:
--   organisations_update_owner_or_admin (20260722103100, altered 20260806140000) still
--   lets an admin write any owner_id directly through the general UPDATE policy — the
--   matrix has tracked this since it was written: "Currently the org UPDATE policy
--   allows an admin to set any owner_id; a dedicated assign_organisation_owner RPC
--   (with audit) is the future form" (§2). That path is unaudited — no audit_log row —
--   which is the same gap create_claim_organisation_rpc closed for a CAM's own claim.
--   F163 AC2 ("an admin isn't silently overwriting an existing assignment without
--   visibility") and the general audit-log-pattern.md requirement that any ownership
--   write is traceable cannot hold while this second, unaudited path stays open.
--
--   It is also gap 1 of #298 ("Ownership can be assigned to a deactivated user"): the
--   raw policy path does not check the new owner is active, only reassign_ownership
--   does. Closing the path removes both problems at once — there is no longer a way to
--   set owner_id that isn't reassign_ownership or claim_organisation, and both already
--   enforce `is_active` on the incoming owner.
--
-- WHY A COLUMN-LEVEL REVOKE AND NOT A POLICY REWRITE:
--   RLS is row-level; it cannot let a write through for every column except one. The
--   redefine_outreach_status_pipeline migration already established the mechanism for
--   this exact shape of problem — a table-level UPDATE grant on organisations, narrowed
--   to an explicit column list that omits the one column moving behind an RPC. This
--   migration does the same thing again for owner_id, on top of that migration's list
--   (which still includes owner_id today).
--
--   organisations_update_owner_or_admin itself is untouched: its owner_id-based
--   branches (a CAM may target a row they own or an unowned one; WITH CHECK pins a
--   non-admin's owner_id to themselves) become inert for owner_id specifically now that
--   the column cannot be written that way, but the policy still governs every other
--   column on the row (canonical fields, admin-only), so rewriting it would only remove
--   dead branches at the cost of touching code that is still load-bearing elsewhere.
--
-- WHAT THIS DOES NOT COVER:
--   The known canonical-field-editing gap (tracked to F224, see 20260722103100's
--   comment) is untouched. #298's second gap (deactivate_user's already_deactivated
--   early return skipping the owned-client recheck) is a different code path
--   (create_deactivate_user_rpc) and is not addressed here.
--
-- Schema change approval record (SOP §7):
--   Change        | Revoke table-level UPDATE on organisations from authenticated,
--               | replaced by the redefine_outreach_status_pipeline column list minus
--               | owner_id. No table or column added/removed.
--   Reason        | F163 AC2 (audited, non-silent admin assignment); closes the
--               | "admin path shipped; RPC deferred" gap the matrix already
--               | anticipated; closes #298 gap 1.
--   Compatibility | An admin's direct PATCH of organisations.owner_id through
--               | PostgREST, previously accepted, now fails a column-privilege
--               | check; grepped, the app never used that path — every current
--               | owner_id write already goes through claim_organisation or
--               | reassign_ownership.
--   Security      | No new privilege granted. Narrows an existing one.
--   Documentation | Matrix §3.2 and its summary table updated in the same PR.
--               | No Data Model tab change — no schema object added.
--               | Approved by Bashir (Project Leader), 10 Aug 2026.
--
-- Reversibility: paired rollback in
--   ../rollback/20260810110000_close_admin_owner_id_direct_write.down.sql

revoke update on public.organisations from authenticated;
grant update (
  id, legal_name, trading_name, country_code, is_international, entry_method,
  is_verified, organisation_type, website, contact_email, address_line_1, city,
  postcode, geographic_reach, data_completeness_score, is_seed,
  created_at, updated_at
) on public.organisations to authenticated;
