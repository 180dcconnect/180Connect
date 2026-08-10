-- Rollback for 20260810110000_close_admin_owner_id_direct_write.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- WARNING — this re-opens organisations.owner_id to direct UPDATE by any admin
-- (unaudited, no is_active check on the incoming owner), re-introducing the gap
-- F163 and #298 gap 1 closed. Roll back only to unblock a failed deploy, and fix
-- forward promptly.

revoke update on public.organisations from authenticated;
grant update (
  id, legal_name, trading_name, country_code, is_international, entry_method,
  is_verified, organisation_type, website, contact_email, address_line_1, city,
  postcode, geographic_reach, data_completeness_score, owner_id, is_seed,
  created_at, updated_at
) on public.organisations to authenticated;
