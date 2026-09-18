-- Migration: allow_admin_read_outreach_preferences
-- Sequence step 21.1 (addition to OUTREACH_PREFERENCES)
-- Story: F187 View CAM Settings (#183)
-- Spec: docs/rls-permission-matrix.md §3.13
--
-- SCOPE:
--   Allows active administrators (app.is_active_user() and app.is_admin()) to read
--   any CAM's outreach preferences (preferred_geographic_reach, preferred_sectors,
--   preferred_income_bands) so that administrators can understand why a CAM's queue
--   looks the way it does (F187 AC1).
--
-- PRIVACY (F187 AC2):
--   OUTREACH_PREFERENCES only contains queue-weighting preferences (geography, sector,
--   income band) and no unrelated personal account settings or credentials.
--
-- NON-INTRUSIVE (F187 AC3):
--   This is a pure SELECT grant. Viewing preferences does not notify or restrict the CAM.
--
-- Reversibility: paired rollback in ../rollback/20260819100000_allow_admin_read_outreach_preferences.down.sql

create policy outreach_preferences_select_admin on public.outreach_preferences
  for select to authenticated
  using (app.is_active_user() and app.is_admin());
