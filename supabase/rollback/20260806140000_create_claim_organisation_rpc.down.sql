-- Rollback for 20260806140000_create_claim_organisation_rpc.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- WARNING — this restores the direct-claim policy path claim_organisation() replaced:
-- a CAM can once again set owner_id on an unowned organisation straight through
-- PostgREST, with no audit row. Roll back only to unblock a failed deploy, and fix
-- forward promptly; F162 AC3 (audited claim) does not hold while this is reverted.

alter policy organisations_update_owner_or_admin on public.organisations
  using (
    app.is_admin()
    or (app.is_cam() and (owner_id is null or owner_id = (select auth.uid())))
  )
  with check (
    app.is_admin()
    or (app.is_cam() and coalesce(owner_id = (select auth.uid()), false))
  );

drop function if exists public.claim_organisation(uuid);
